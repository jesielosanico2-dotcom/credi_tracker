const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { createMySqlStore } = require("../src/mysql-store");
const { AuthError, createMySqlAuth } = require("../src/auth");

const rowsByTable = {
  store_settings: [{ storeName: "Aling Nena's Sari-Sari Store", currency: "PHP" }],
  customers: [{
    id: "cus-maria-santos",
    name: "Maria Santos",
    phone: "0917 123 4567",
    purok: "Purok 3",
    creditLimit: "1000.00",
    status: "active",
    createdAt: "2026-09-12 08:00:00"
  }],
  applications: [{
    id: "app-pedro-reyes",
    type: "newCustomer",
    status: "pending",
    customerName: "Pedro Reyes",
    phone: "",
    purok: "Purok 2",
    requestedLimit: "500.00",
    note: "New customer credit request",
    customerId: null,
    createdAt: "2026-10-25 08:00:00",
    reviewedAt: null
  }],
  transactions: [{
    id: "txn-maria-first-credit",
    customerId: "cus-maria-santos",
    type: "credit",
    amount: "200.00",
    note: "Rice and canned goods",
    date: "2026-10-05",
    dueDate: "2026-10-20",
    createdAt: "2026-10-05 09:00:00",
    voidedAt: null,
    voidReason: ""
  }]
};

function createFakePool() {
  const statements = [];
  const connection = {
    async beginTransaction() { statements.push({ type: "begin" }); },
    async commit() { statements.push({ type: "commit" }); },
    async rollback() { statements.push({ type: "rollback" }); },
    release() { statements.push({ type: "release" }); },
    async query(sql) {
      if (sql.includes("FOR UPDATE")) return [[], []];
      const table = sql.match(/FROM ([a-z_]+)/)?.[1];
      return [rowsByTable[table] || [], []];
    },
    async execute(sql, values) {
      statements.push({ type: "execute", sql, values });
      return [{ affectedRows: 1 }, []];
    }
  };
  return {
    statements,
    async getConnection() { return connection; },
    async query(sql) { return connection.query(sql); }
  };
}

test("MySQL store maps decimal and date fields into the app data model", async () => {
  const store = createMySqlStore(createFakePool());
  const data = await store.read();
  assert.equal(data.settings.storeName, "Aling Nena's Sari-Sari Store");
  assert.equal(data.customers[0].creditLimit, 1000);
  assert.equal(data.customers[0].createdAt, "2026-09-12T08:00:00Z");
  assert.equal(data.applications[0].requestedLimit, 500);
  assert.equal(data.transactions[0].amount, 200);
  assert.equal(data.transactions[0].date, "2026-10-05");
  assert.equal(data.transactions[0].createdAt, "2026-10-05T09:00:00Z");
});

test("MySQL store commits updates and rolls them back on validation errors", async () => {
  const pool = createFakePool();
  const store = createMySqlStore(pool);
  const result = await store.update((data) => {
    data.customers[0].creditLimit = 1200;
    return data.customers[0].creditLimit;
  });

  test("owner password reset updates only the password and revokes existing sessions", async () => {
    const statements = [];
    const pool = {
      async execute(sql, params) {
        statements.push({ sql, params });
        return [[{ id: 1 }], []];
      },
      async getConnection() {
        return {
          async beginTransaction() { statements.push({ type: "begin" }); },
          async execute(sql, params) { statements.push({ sql, params }); },
          async commit() { statements.push({ type: "commit" }); },
          async rollback() { statements.push({ type: "rollback" }); },
          release() { statements.push({ type: "release" }); }
        };
      }
    };
    const auth = createMySqlAuth(pool);
    await assert.rejects(auth.resetPassword("short"), AuthError);
    assert.equal(statements.length, 0);

    await auth.resetPassword("a-new-secure-password");
    const passwordUpdate = statements.find((statement) => statement.sql?.startsWith("UPDATE owner_accounts"));
    assert.ok(passwordUpdate);
    assert.notEqual(passwordUpdate.params[1], "a-new-secure-password");
    assert.equal(statements.some((statement) => statement.sql === "DELETE FROM owner_sessions"), true);
    assert.equal(statements.some((statement) => statement.sql?.startsWith("DELETE FROM customers")), false);
    assert.equal(statements.some((statement) => statement.sql?.startsWith("DELETE FROM transactions")), false);
    assert.equal(statements.some((statement) => statement.type === "commit"), true);
  });

  assert.equal(result, 1200);
  assert.ok(pool.statements.some((statement) => statement.type === "commit"));
  assert.ok(pool.statements.some((statement) => statement.type === "execute" && statement.sql.includes("INSERT INTO customers")));
  assert.equal(pool.statements.some((statement) => statement.type === "rollback"), false);

  await assert.rejects(
    store.update(() => { throw new Error("validation failed"); }),
    /validation failed/
  );
  assert.equal(pool.statements.filter((statement) => statement.type === "rollback").length, 1);
});

test("database JSON describes all tables, relationships, and sample records", async () => {
  const schema = JSON.parse(await fs.readFile(path.join(__dirname, "database", "data.json"), "utf8"));
  assert.equal(schema.database.name, "credit_tracker");
  assert.equal(schema.database.charset, "utf8mb4");
  assert.equal(schema.database.collation, "utf8mb4_unicode_ci");
  for (const table of ["store_settings", "owner_accounts", "owner_sessions", "customers", "applications", "transactions"]) {
    assert.ok(schema.tables[table], `Expected ${table} schema`);
  }
  assert.equal(schema.tables.customers.columns.credit_limit.type, "DECIMAL(12,2)");
  assert.ok(schema.tables.transactions.foreignKeys.some((key) => key.references.table === "customers"));
  assert.equal(schema.initialData.customers.length, 4);
  assert.equal(schema.initialData.applications[0].id, "app-pedro-reyes");
  assert.equal(schema.initialData.transactions.length, 7);
});

test("XAMPP SQL creates the database schema and sample records", async () => {
  const sql = await fs.readFile(path.join(__dirname, "..", "credit_tracker.sql"), "utf8");
  assert.match(sql, /CREATE DATABASE IF NOT EXISTS credit_tracker/i);
  for (const table of ["store_settings", "owner_accounts", "owner_sessions", "customers", "applications", "transactions"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i"));
  }
  assert.match(sql, /ENGINE=InnoDB/i);
  assert.match(sql, /FOREIGN KEY \(customer_id\) REFERENCES customers\(id\)/i);
  assert.match(sql, /cus-maria-santos/);
  assert.match(sql, /cus-juan-dela-cruz/);
  assert.match(sql, /cus-lorna-cruz/);
  assert.match(sql, /txn-tonyo-credit/);
  assert.match(sql, /txn-maria-first-credit/);
  assert.match(sql, /txn-juan-payment/);
});

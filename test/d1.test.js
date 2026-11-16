const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../src/server");
const { createD1Auth, hashPassword } = require("../src/d1-auth");
const { createD1Store } = require("../src/d1-store");

function createFakeD1() {
  const rows = {
    app_state: [{
      id: 1,
      version: 1,
      data: JSON.stringify({
        settings: { storeName: "Test Store", currency: "PHP" },
        customers: [],
        applications: [],
        transactions: []
      })
    }],
    owner_accounts: [],
    owner_sessions: []
  };
  let forceConflict = false;

  function statement(sql, values = []) {
    return {
      sql,
      values,
      bind(...boundValues) {
        return statement(sql, boundValues);
      },
      async first() {
        if (sql.includes("FROM app_state")) return rows.app_state[0] || null;
        if (sql.includes("FROM owner_accounts") && sql.includes("password_salt")) return rows.owner_accounts[0] || null;
        if (sql.includes("FROM owner_accounts")) return rows.owner_accounts.length ? { configured: 1 } : null;
        if (sql.includes("FROM owner_sessions")) {
          const session = rows.owner_sessions.find((item) =>
            item.token_hash === values[0] && item.expires_at > values[1]
          );
          if (!session) return null;
          return { username: rows.owner_accounts[0]?.username };
        }
        throw new Error(`Unexpected first query: ${sql}`);
      },
      async run() {
        if (sql.startsWith("UPDATE app_state")) {
          if (forceConflict) {
            forceConflict = false;
            return { meta: { changes: 0 } };
          }
          const state = rows.app_state[0];
          if (state.version !== values[1]) return { meta: { changes: 0 } };
          state.data = values[0];
          state.version += 1;
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM owner_sessions")) {
          const before = rows.owner_sessions.length;
          if (sql.includes("WHERE token_hash = ?")) {
            rows.owner_sessions = rows.owner_sessions.filter((item) => item.token_hash !== values[0]);
          } else {
            rows.owner_sessions = [];
          }
          return { meta: { changes: before - rows.owner_sessions.length } };
        }
        throw new Error(`Unexpected run query: ${sql}`);
      }
    };
  }

  return {
    rows,
    conflictOnce() { forceConflict = true; },
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      for (const item of statements) {
        if (item.sql.startsWith("INSERT INTO owner_accounts")) {
          if (rows.owner_accounts.length) throw new Error("UNIQUE constraint failed: owner_accounts.id");
          const [username, salt, hash, iterations] = item.values;
          rows.owner_accounts.push({
            id: 1,
            username,
            salt,
            passwordHash: hash,
            iterations
          });
        } else if (item.sql.startsWith("DELETE FROM owner_sessions")) {
          rows.owner_sessions = [];
        } else if (item.sql.startsWith("INSERT INTO owner_sessions")) {
          const [tokenHash, createdAt, expiresAt] = item.values;
          rows.owner_sessions.push({ token_hash: tokenHash, created_at: createdAt, expires_at: expiresAt });
        } else {
          throw new Error(`Unexpected batch query: ${item.sql}`);
        }
      }
      return [];
    }
  };
}

test("D1 store retries optimistic concurrent writes without losing updates", async () => {
  const database = createFakeD1();
  const store = createD1Store(database);
  let changes = 0;
  database.conflictOnce();

  await store.update((data) => {
    changes += 1;
    data.customers.push({
      id: `customer-${changes}`,
      name: "Test Customer",
      phone: "",
      purok: "Purok 1",
      creditLimit: 100,
      status: "active",
      createdAt: new Date().toISOString()
    });
  });

  assert.equal(changes, 2);
  assert.equal((await store.read()).customers.length, 1);
});

test("D1 authentication sets up once, signs in, validates, and logs out", async () => {
  const database = createFakeD1();
  const auth = createD1Auth(database);
  assert.deepEqual(await auth.status(), { setupRequired: true });

  const created = await auth.setup("store.owner", "secure-test-password-123");
  assert.deepEqual(await auth.status(), { setupRequired: false });
  const storedOwner = database.rows.owner_accounts[0];
  const recomputedHash = await hashPassword(
    "secure-test-password-123",
    Uint8Array.from(storedOwner.salt.match(/.{2}/g), (byte) => Number.parseInt(byte, 16)),
    storedOwner.iterations
  );
  assert.equal(
    Buffer.from(recomputedHash).toString("hex"),
    storedOwner.passwordHash
  );

  await assert.rejects(
    auth.setup("another.owner", "another-secure-password"),
    { status: 409 }
  );

  const login = await auth.login("store.owner", "secure-test-password-123");
  const request = { headers: { cookie: `credit_tracker_session=${login.token}` } };
  assert.deepEqual(await auth.validate(request), { username: "store.owner" });
  await auth.logout(request);
  assert.equal(await auth.validate(request), null);
  assert.notEqual(created.token, login.token);
});

test("API accepts D1 adapters and protects first-owner setup", async () => {
  const database = createFakeD1();
  const server = createApp({
    store: createD1Store(database),
    auth: createD1Auth(database),
    secureCookies: true,
    setupKeyRequired: true,
    setupKey: "test-worker-setup-key"
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const status = await fetch(`${baseUrl}/api/auth/status`);
    assert.deepEqual(await status.json(), {
      setupRequired: true,
      authenticated: false,
      setupKeyRequired: true
    });

    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setupKey: "test-worker-setup-key",
        username: "worker.owner",
        password: "worker-owner-password"
      })
    });
    assert.equal(setup.status, 201);
    assert.match(setup.headers.get("set-cookie"), /Secure/);

    const customerRequest = await fetch(`${baseUrl}/api/customers`, {
      headers: { Cookie: setup.headers.get("set-cookie").split(";")[0] }
    });
    assert.equal(customerRequest.status, 200);
    assert.deepEqual(await customerRequest.json(), { customers: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

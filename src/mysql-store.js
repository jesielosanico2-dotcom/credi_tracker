function asIsoDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const string = String(value);
  if (string.includes("T")) return string.endsWith("Z") ? string : `${string}Z`;
  return `${string.replace(" ", "T")}Z`;
}

function asMySqlDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid database datetime value.");
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function createMySqlStore(pool) {
  async function read(connection = pool) {
    const [settingsRows, customerRows, applicationRows, transactionRows] = await Promise.all([
      connection.query("SELECT store_name AS storeName, currency FROM store_settings WHERE id = 1"),
      connection.query("SELECT id, name, phone, purok, credit_limit AS creditLimit, status, created_at AS createdAt FROM customers ORDER BY created_at, name"),
      connection.query("SELECT id, type, status, customer_name AS customerName, phone, purok, requested_limit AS requestedLimit, note, customer_id AS customerId, created_at AS createdAt, reviewed_at AS reviewedAt FROM applications ORDER BY created_at"),
      connection.query("SELECT id, customer_id AS customerId, type, amount, note, transaction_date AS date, due_date AS dueDate, created_at AS createdAt, voided_at AS voidedAt, void_reason AS voidReason FROM transactions ORDER BY transaction_date, created_at")
    ]);
    const [settingsRowsResult, customerRowsResult, applicationRowsResult, transactionRowsResult] = [
      settingsRows[0],
      customerRows[0],
      applicationRows[0],
      transactionRows[0]
    ];
    const settings = settingsRowsResult[0] || { storeName: "Credit Tracker", currency: "PHP" };

    return {
      settings: { storeName: settings.storeName, currency: settings.currency },
      customers: customerRowsResult.map((customer) => ({
        ...customer,
        creditLimit: Number(customer.creditLimit),
        createdAt: asIsoDateTime(customer.createdAt)
      })),
      applications: applicationRowsResult.map((application) => ({
        ...application,
        requestedLimit: Number(application.requestedLimit),
        customerId: application.customerId || undefined,
        createdAt: asIsoDateTime(application.createdAt),
        reviewedAt: asIsoDateTime(application.reviewedAt) || undefined
      })),
      transactions: transactionRowsResult.map((transaction) => ({
        ...transaction,
        amount: Number(transaction.amount),
        date: String(transaction.date).slice(0, 10),
        dueDate: transaction.dueDate ? String(transaction.dueDate).slice(0, 10) : null,
        createdAt: asIsoDateTime(transaction.createdAt),
        voidedAt: asIsoDateTime(transaction.voidedAt),
        voidReason: transaction.voidReason || ""
      }))
    };
  }

  async function write(connection, data) {
    await connection.execute(
      `INSERT INTO store_settings (id, store_name, currency) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE store_name = VALUES(store_name), currency = VALUES(currency)`,
      [data.settings.storeName, data.settings.currency]
    );

    for (const customer of data.customers) {
      await connection.execute(
        `INSERT INTO customers (id, name, phone, purok, credit_limit, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone), purok = VALUES(purok),
           credit_limit = VALUES(credit_limit), status = VALUES(status)`,
        [customer.id, customer.name, customer.phone || "", customer.purok, customer.creditLimit, customer.status, asMySqlDateTime(customer.createdAt)]
      );
    }

    for (const application of data.applications) {
      await connection.execute(
        `INSERT INTO applications (id, type, status, customer_name, phone, purok, requested_limit, note, customer_id, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE type = VALUES(type), status = VALUES(status), customer_name = VALUES(customer_name),
           phone = VALUES(phone), purok = VALUES(purok), requested_limit = VALUES(requested_limit), note = VALUES(note),
           customer_id = VALUES(customer_id), reviewed_at = VALUES(reviewed_at)`,
        [
          application.id,
          application.type,
          application.status,
          application.customerName,
          application.phone || "",
          application.purok || "",
          application.requestedLimit,
          application.note || "",
          application.customerId || null,
          asMySqlDateTime(application.createdAt),
          asMySqlDateTime(application.reviewedAt)
        ]
      );
    }

    for (const transaction of data.transactions) {
      await connection.execute(
        `INSERT INTO transactions (id, customer_id, type, amount, note, transaction_date, due_date, created_at, voided_at, void_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE customer_id = VALUES(customer_id), type = VALUES(type), amount = VALUES(amount),
           note = VALUES(note), transaction_date = VALUES(transaction_date), due_date = VALUES(due_date),
           voided_at = VALUES(voided_at), void_reason = VALUES(void_reason)`,
        [
          transaction.id,
          transaction.customerId,
          transaction.type,
          transaction.amount,
          transaction.note || "",
          transaction.date,
          transaction.dueDate || null,
          asMySqlDateTime(transaction.createdAt),
          asMySqlDateTime(transaction.voidedAt),
          transaction.voidReason || ""
        ]
      );
    }
  }

  async function update(change) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM store_settings WHERE id = 1 FOR UPDATE");
      const data = await read(connection);
      const result = await change(data);
      await write(connection, data);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { read, update };
}

async function replaceMySqlData(pool, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM store_settings WHERE id = 1 FOR UPDATE");
    await connection.execute("DELETE FROM transactions");
    await connection.execute("DELETE FROM applications");
    await connection.execute("DELETE FROM customers");
    await connection.execute("DELETE FROM store_settings");
    await connection.execute(
      "INSERT INTO store_settings (id, store_name, currency) VALUES (1, ?, ?)",
      [data.settings.storeName, data.settings.currency]
    );
    for (const customer of data.customers) {
      await connection.execute(
        `INSERT INTO customers (id, name, phone, purok, credit_limit, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
        customer.id, customer.name, customer.phone || "", customer.purok, customer.creditLimit, customer.status, asMySqlDateTime(customer.createdAt)
        ]
      );
    }
    for (const application of data.applications) {
      await connection.execute(
        `INSERT INTO applications (id, type, status, customer_name, phone, purok, requested_limit, note, customer_id, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
        application.id,
        application.type,
        application.status,
        application.customerName,
        application.phone || "",
        application.purok || "",
        application.requestedLimit,
        application.note || "",
        application.customerId || null,
        asMySqlDateTime(application.createdAt),
        asMySqlDateTime(application.reviewedAt)
        ]
      );
    }
    for (const transaction of data.transactions) {
      await connection.execute(
        `INSERT INTO transactions (id, customer_id, type, amount, note, transaction_date, due_date, created_at, voided_at, void_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
        transaction.id,
        transaction.customerId,
        transaction.type,
        transaction.amount,
        transaction.note || "",
        transaction.date,
        transaction.dueDate || null,
        asMySqlDateTime(transaction.createdAt),
        asMySqlDateTime(transaction.voidedAt),
        transaction.voidReason || ""
        ]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createMySqlStore, replaceMySqlData };

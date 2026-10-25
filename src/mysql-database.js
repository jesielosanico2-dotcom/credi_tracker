const mysql = require("mysql2/promise");

function createDatabasePool(options = {}) {
  const ssl = options.ssl ?? (process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined);
  const pool = mysql.createPool({
    host: options.host || process.env.DB_HOST || "127.0.0.1",
    port: Number(options.port || process.env.DB_PORT || 3306),
    database: options.database || process.env.DB_NAME || "credit_tracker",
    user: options.user || process.env.DB_USER || "root",
    password: options.password ?? process.env.DB_PASSWORD ?? "",
    waitForConnections: true,
    connectionLimit: Number(options.connectionLimit || process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    dateStrings: true,
    timezone: "Z",
    charset: "utf8mb4",
    ...(ssl ? { ssl } : {})
  });
  return pool;
}

module.exports = { createDatabasePool };

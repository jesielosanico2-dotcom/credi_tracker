require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { createDatabasePool } = require("../src/mysql-database");
const { createMySqlStore } = require("../src/mysql-store");

async function main() {
  const outputPath = path.join(__dirname, "..", "data", "db.json");
  const pool = createDatabasePool();
  try {
    await pool.query("SELECT 1");
    const data = await createMySqlStore(pool).read();
    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Exported ${data.customers.length} customers, ${data.applications.length} applications, and ${data.transactions.length} transactions to data/db.json.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Could not export MySQL data to JSON:", error.message);
  process.exitCode = 1;
});

const cloudMode = process.argv.includes("--cloud");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenvConfig = require("dotenv").config(cloudMode ? { path: path.join(__dirname, "..", ".env.cloud") } : undefined);
const { createDatabasePool } = require("../src/mysql-database");
const { replaceMySqlData } = require("../src/mysql-store");

async function main() {
  if (cloudMode && dotenvConfig.error) {
    throw new Error("Could not load .env.cloud. Copy .env.cloud.example to .env.cloud and add the cloud database settings.");
  }
  if (cloudMode && ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].some((key) => !process.env[key])) {
    throw new Error("Set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD in .env.cloud before importing.");
  }
  const jsonPath = path.join(__dirname, "..", "data", "db.json");
  const data = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const pool = createDatabasePool();
  try {
    await pool.query("SELECT 1");
    await replaceMySqlData(pool, data);
    const destination = cloudMode ? "cloud MySQL" : "MySQL";
    console.log(`Imported ${data.customers.length} customers, ${data.applications.length} applications, and ${data.transactions.length} transactions into ${destination}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Could not import JSON data into MySQL:", error.message);
  process.exitCode = 1;
});

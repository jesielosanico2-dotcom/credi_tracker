const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const inputPath = path.join(__dirname, "..", "data", "db.json");
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (
    !data.settings ||
    !Array.isArray(data.customers) ||
    !Array.isArray(data.applications) ||
    !Array.isArray(data.transactions)
  ) {
    throw new Error("data/db.json does not contain valid store settings, customers, applications, and transactions.");
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "credit-tracker-d1-"));
  const sqlPath = path.join(tempDirectory, "import.sql");
  try {
    const serializedData = JSON.stringify(data);
    const sql = `UPDATE app_state SET data = ${sqlString(serializedData)}, version = version + 1 WHERE id = 1;\n`;
    await fs.writeFile(sqlPath, sql, "utf8");

    const wranglerPath = path.join(
      path.dirname(require.resolve("wrangler/package.json")),
      "bin",
      "wrangler.js"
    );
    const result = spawnSync(
      process.execPath,
      [wranglerPath, "d1", "execute", "credit-tracker", "--remote", "--file", sqlPath],
      { stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler D1 import failed with exit code ${result.status}.`);
    console.log(
      `Imported ${data.customers.length} customers, ${data.applications.length} applications, and ${data.transactions.length} transactions to D1.`
    );
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Could not import JSON data into Cloudflare D1:", error.message);
  process.exitCode = 1;
});

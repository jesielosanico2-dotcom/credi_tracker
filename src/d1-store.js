const defaultData = {
  settings: { storeName: "BURNICO SARI-SARI Store", currency: "PHP" },
  customers: [],
  applications: [],
  transactions: []
};

function createD1Store(database) {
  async function read() {
    const row = await database
      .prepare("SELECT data FROM app_state WHERE id = 1")
      .first();
    if (!row) throw new Error("D1 app_state is missing. Apply the Cloudflare D1 migration first.");
    return JSON.parse(row.data);
  }

  async function update(change) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const row = await database
        .prepare("SELECT version, data FROM app_state WHERE id = 1")
        .first();
      if (!row) throw new Error("D1 app_state is missing. Apply the Cloudflare D1 migration first.");

      const data = JSON.parse(row.data);
      const result = await change(data);
      const write = await database
        .prepare("UPDATE app_state SET data = ?, version = version + 1 WHERE id = 1 AND version = ?")
        .bind(JSON.stringify(data), row.version)
        .run();
      if (write.meta.changes === 1) return result;
    }
    throw new Error("Could not save changes because the store is busy. Please retry the request.");
  }

  return { read, update };
}

module.exports = { createD1Store, defaultData };

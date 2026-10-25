const fs = require("node:fs/promises");
const path = require("node:path");

function createStore(filePath) {
  let pendingWrite = Promise.resolve();

  async function read() {
    const contents = await fs.readFile(filePath, "utf8");
    return JSON.parse(contents);
  }

  function update(change) {
    const operation = pendingWrite.then(async () => {
      const data = await read();
      const result = await change(data);
      const temporaryPath = `${filePath}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, filePath);
      return result;
    });

    pendingWrite = operation.catch(() => {});
    return operation;
  }

  return { read, update };
}

module.exports = { createStore, defaultDataPath: path.join(__dirname, "..", "data", "db.json") };

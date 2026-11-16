const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { stdin, stdout } = require("node:process");
const { StringDecoder } = require("node:string_decoder");
const { hashPassword } = require("../src/d1-auth");

const databaseName = "credit-tracker";
const wranglerCli = path.resolve(__dirname, "..", "node_modules", "wrangler", "bin", "wrangler.js");

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command from an interactive terminal so your password can be hidden."));
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();

    function finish(error) {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(buffer) {
      for (const character of decoder.write(buffer)) {
        const code = character.codePointAt(0);
        if (code === 3) {
          finish(new Error("Password reset cancelled."));
          return;
        }
        if (code === 13 || code === 10) {
          finish();
          return;
        }
        if (code === 8 || code === 127) {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join("");
            stdout.write("\b \b");
          }
          continue;
        }
        if (!/^\p{C}/u.test(character)) {
          value += character;
          stdout.write("*");
        }
      }
    }

    stdin.on("data", onData);
  });
}

function executeRemoteSql(sql) {
  let output;
  try {
    output = execFileSync(process.execPath, [
      wranglerCli,
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      sql,
      "--json",
      "--yes"
    ], { encoding: "utf8", windowsHide: true });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    throw new Error(stderr || error.message);
  }

  let results;
  try {
    results = JSON.parse(output);
  } catch {
    throw new Error("Wrangler returned an unexpected response while updating the hosted database.");
  }
  if (!Array.isArray(results) || results.length === 0 || results.some((result) => result.success !== true)) {
    throw new Error("Wrangler did not confirm the hosted database operation.");
  }
  return results.flatMap((result) => result.results || []);
}

async function main() {
  const owners = executeRemoteSql("SELECT id FROM owner_accounts WHERE id = 1");
  if (owners.length === 0) {
    throw new Error("No hosted owner account exists. Create the owner account in the deployed app first.");
  }

  stdout.write("Resetting the hosted owner password.\n");
  const firstPassword = await readHidden("New password (12-128 characters): ");
  if (firstPassword.length < 12 || firstPassword.length > 128) {
    throw new Error("Choose a password with 12 to 128 characters. No changes were made.");
  }
  const confirmedPassword = await readHidden("Confirm new password: ");
  if (firstPassword !== confirmedPassword) {
    throw new Error("The passwords do not match. No changes were made.");
  }

  const salt = randomBytes(16);
  const saltHex = salt.toString("hex");
  const passwordHash = Buffer.from(await hashPassword(firstPassword, salt)).toString("hex");
  executeRemoteSql(
    `UPDATE owner_accounts SET password_salt = '${saltHex}', password_hash = '${passwordHash}', password_iterations = 100000 WHERE id = 1; DELETE FROM owner_sessions;`
  );

  const verification = executeRemoteSql(
    `SELECT password_salt = '${saltHex}' AS password_updated, (SELECT COUNT(*) FROM owner_sessions) AS remaining_sessions FROM owner_accounts WHERE id = 1`
  );
  if (verification.length !== 1 || verification[0].password_updated !== 1 || verification[0].remaining_sessions !== 0) {
    throw new Error("The hosted password update could not be verified.");
  }

  stdout.write("Hosted owner password updated. Existing sign-in sessions were signed out; customer and transaction data were not changed.\n");
}

main().catch((error) => {
  console.error(`Cloud password reset failed: ${error.message}`);
  process.exitCode = 1;
});

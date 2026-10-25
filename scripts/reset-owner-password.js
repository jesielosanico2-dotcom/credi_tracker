require("dotenv").config();

const { stdin, stdout } = require("node:process");
const { StringDecoder } = require("node:string_decoder");
const { createDatabasePool } = require("../src/mysql-database");
const { createMySqlAuth } = require("../src/auth");

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

async function main() {
  const pool = createDatabasePool();
  try {
    const [owners] = await pool.execute("SELECT username FROM owner_accounts WHERE id = 1");
    if (owners.length === 0) {
      throw new Error("No owner account exists. Start the app and create an owner account first.");
    }

    stdout.write(`Resetting the password for owner "${owners[0].username}".\n`);
    const firstPassword = await readHidden("New password (12-128 characters): ");
    const confirmedPassword = await readHidden("Confirm new password: ");
    if (firstPassword !== confirmedPassword) {
      throw new Error("The passwords do not match. No changes were made.");
    }

    await createMySqlAuth(pool).resetPassword(firstPassword);
    stdout.write("Owner password updated. Existing sign-in sessions were signed out. Customer and transaction data were not changed.\n");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  if (error.message !== "Password reset cancelled.") {
    console.error(`Password reset failed: ${error.message}`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

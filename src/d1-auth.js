const { AuthError } = require("./auth-error");

const sessionDurationMs = 12 * 60 * 60 * 1000;
const passwordIterations = 100000;
const textEncoder = new TextEncoder();

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator >= 0 && item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

async function hashPassword(password, salt, iterations = passwordIterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256
  );
  return new Uint8Array(bits);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
  return toHex(new Uint8Array(digest));
}

function equalBytes(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
  return difference === 0;
}

function createD1Auth(database) {
  async function setup(username, password) {
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) {
      throw new AuthError(400, "Username must be 3–40 characters and use only letters, numbers, dots, hyphens, or underscores.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new AuthError(400, "Choose a password with 12 to 128 characters.");
    }

    const salt = randomBytes(16);
    const passwordHash = await hashPassword(password, salt);
    const token = toBase64Url(randomBytes(32));
    const now = Date.now();
    try {
      await database.batch([
        database.prepare(
          "INSERT INTO owner_accounts (id, username, password_salt, password_hash, password_iterations) VALUES (1, ?, ?, ?, ?)"
        ).bind(username.trim(), toHex(salt), toHex(passwordHash), passwordIterations),
        database.prepare("DELETE FROM owner_sessions"),
        database.prepare(
          "INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 1, ?, ?)"
        ).bind(
          await hashToken(token),
          new Date(now).toISOString(),
          new Date(now + sessionDurationMs).toISOString()
        )
      ]);
    } catch (error) {
      if (/UNIQUE constraint failed|PRIMARY KEY/i.test(error.message)) {
        throw new AuthError(409, "An owner account has already been set up.");
      }
      throw error;
    }
    return { token, username: username.trim() };
  }

  async function login(username, password) {
    if (typeof password !== "string" || password.length > 128) {
      throw new AuthError(400, "Enter your password.");
    }
    const owner = await database
      .prepare("SELECT username, password_salt AS salt, password_hash AS passwordHash, password_iterations AS iterations FROM owner_accounts WHERE id = 1")
      .first();
    if (!owner) throw new AuthError(409, "Set up the owner account before signing in.");

    const suppliedUsername = typeof username === "string" && username.trim()
      ? username.trim()
      : owner.username;
    const matchesUsername = suppliedUsername.toLowerCase() === owner.username.toLowerCase();
    const salt = fromHex(owner.salt);
    const actual = await hashPassword(password, salt, owner.iterations);
    if (!matchesUsername || !equalBytes(actual, fromHex(owner.passwordHash))) {
      throw new AuthError(401, "Incorrect username or password.");
    }

    const token = toBase64Url(randomBytes(32));
    const now = Date.now();
    await database.batch([
      database.prepare("DELETE FROM owner_sessions"),
      database.prepare(
        "INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 1, ?, ?)"
      ).bind(
        await hashToken(token),
        new Date(now).toISOString(),
        new Date(now + sessionDurationMs).toISOString()
      )
    ]);
    return { token, username: owner.username };
  }

  async function validate(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return null;
    const row = await database.prepare(
      `SELECT owner.username
       FROM owner_sessions AS sessions
       INNER JOIN owner_accounts AS owner ON owner.id = sessions.owner_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?
       LIMIT 1`
    ).bind(await hashToken(token), new Date().toISOString()).first();
    return row ? { username: row.username } : null;
  }

  async function logout(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return;
    await database.prepare("DELETE FROM owner_sessions WHERE token_hash = ?")
      .bind(await hashToken(token))
      .run();
  }

  async function status() {
    const owner = await database.prepare("SELECT 1 AS configured FROM owner_accounts WHERE id = 1").first();
    return { setupRequired: !owner };
  }

  return { setup, login, logout, status, validate };
}

module.exports = { createD1Auth, hashPassword };

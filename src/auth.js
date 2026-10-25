const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(scryptCallback);
const sessionDurationMs = 12 * 60 * 60 * 1000;
const dummySalt = Buffer.alloc(16, 42);
const dummyHash = Buffer.alloc(64, 42);

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

function createAuth(filePath) {
  let pendingWrite = Promise.resolve();

  async function read() {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { owner: null, sessions: [] };
      throw error;
    }
  }

  function update(change) {
    const operation = pendingWrite.then(async () => {
      const data = await read();
      const result = await change(data);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.rename(temporaryPath, filePath);
      return result;
    });
    pendingWrite = operation.catch(() => {});
    return operation;
  }

  async function createSession(data) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    data.sessions = [{
      tokenHash: hashSessionToken(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + sessionDurationMs).toISOString()
    }];
    return { token, username: data.owner.username };
  }

  async function setup(username, password) {
    return update(async (data) => {
      if (data.owner) throw new AuthError(409, "An owner account has already been set up.");
      if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) {
        throw new AuthError(400, "Username must be 3–40 characters and use only letters, numbers, dots, hyphens, or underscores.");
      }
      if (typeof password !== "string" || password.length < 12 || password.length > 128) {
        throw new AuthError(400, "Choose a password with 12 to 128 characters.");
      }
      const salt = randomBytes(16);
      const passwordHash = await scrypt(password, salt, 64);
      data.owner = {
        username: username.trim(),
        salt: salt.toString("hex"),
        passwordHash: Buffer.from(passwordHash).toString("hex")
      };
      return createSession(data);
    });
  }

  async function login(username, password) {
    return update(async (data) => {
      if (!data.owner) throw new AuthError(409, "Set up the owner account before signing in.");
      if (typeof password !== "string" || password.length > 128) {
        throw new AuthError(400, "Enter your password.");
      }
      const suppliedUsername = typeof username === "string" && username.trim()
        ? username.trim()
        : data.owner.username;
      const matchesUsername = suppliedUsername.toLowerCase() === data.owner.username.toLowerCase();
      const salt = matchesUsername ? Buffer.from(data.owner.salt, "hex") : dummySalt;
      const expected = matchesUsername ? Buffer.from(data.owner.passwordHash, "hex") : dummyHash;
      const actual = Buffer.from(await scrypt(password, salt, 64));
      if (!matchesUsername || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new AuthError(401, "Incorrect username or password.");
      }
      return createSession(data);
    });
  }

  async function validate(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const data = await read();
    const session = data.sessions.find((item) => {
      const expected = Buffer.from(item.tokenHash, "hex");
      const actual = Buffer.from(tokenHash, "hex");
      return expected.length === actual.length && timingSafeEqual(actual, expected);
    });
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await update((current) => {
        current.sessions = current.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now());
      });
      return null;
    }
    return data.owner ? { username: data.owner.username } : null;
  }

  async function logout(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    await update((data) => {
      data.sessions = data.sessions.filter((item) => item.tokenHash !== tokenHash);
    });
  }

  async function status() {
    const data = await read();
    return { setupRequired: !data.owner };
  }

  return { setup, login, logout, status, validate };
}

function createMySqlAuth(pool) {
  async function createSession(connection, username) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionDurationMs);
    await connection.execute("DELETE FROM owner_sessions");
    await connection.execute(
      "INSERT INTO owner_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
      [hashSessionToken(token), now, expiresAt]
    );
    return { token, username };
  }

  async function setup(username, password) {
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) {
      throw new AuthError(400, "Username must be 3–40 characters and use only letters, numbers, dots, hyphens, or underscores.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new AuthError(400, "Choose a password with 12 to 128 characters.");
    }

    const salt = randomBytes(16);
    const passwordHash = Buffer.from(await scrypt(password, salt, 64));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO owner_accounts (id, username, password_salt, password_hash) VALUES (1, ?, ?, ?)",
        [username.trim(), salt.toString("hex"), passwordHash.toString("hex")]
      );
      const session = await createSession(connection, username.trim());
      await connection.commit();
      return session;
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") {
        throw new AuthError(409, "An owner account has already been set up.");
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function login(username, password) {
    if (typeof password !== "string" || password.length > 128) {
      throw new AuthError(400, "Enter your password.");
    }
    const [rows] = await pool.execute(
      "SELECT username, password_salt AS salt, password_hash AS passwordHash FROM owner_accounts WHERE id = 1"
    );
    const owner = rows[0];
    if (!owner) throw new AuthError(409, "Set up the owner account before signing in.");
    const suppliedUsername = typeof username === "string" && username.trim() ? username.trim() : owner.username;
    const matchesUsername = suppliedUsername.toLowerCase() === owner.username.toLowerCase();
    const salt = matchesUsername ? Buffer.from(owner.salt, "hex") : dummySalt;
    const expected = matchesUsername ? Buffer.from(owner.passwordHash, "hex") : dummyHash;
    const actual = Buffer.from(await scrypt(password, salt, 64));
    if (!matchesUsername || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AuthError(401, "Incorrect username or password.");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const session = await createSession(connection, owner.username);
      await connection.commit();
      return session;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function resetPassword(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new AuthError(400, "Choose a password with 12 to 128 characters.");
    }
    const [rows] = await pool.execute("SELECT id FROM owner_accounts WHERE id = 1");
    if (rows.length === 0) {
      throw new AuthError(404, "No owner account exists yet. Start the app and create an account first.");
    }

    const salt = randomBytes(16);
    const passwordHash = Buffer.from(await scrypt(password, salt, 64));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "UPDATE owner_accounts SET password_salt = ?, password_hash = ? WHERE id = 1",
        [salt.toString("hex"), passwordHash.toString("hex")]
      );
      await connection.execute("DELETE FROM owner_sessions");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function validate(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return null;
    const [rows] = await pool.execute(
      `SELECT owner.username
       FROM owner_sessions AS sessions
       INNER JOIN owner_accounts AS owner ON owner.id = sessions.owner_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [hashSessionToken(token)]
    );
    return rows[0] ? { username: rows[0].username } : null;
  }

  async function logout(request) {
    const token = readCookie(request, "credit_tracker_session");
    if (!token) return;
    await pool.execute("DELETE FROM owner_sessions WHERE token_hash = ?", [hashSessionToken(token)]);
  }

  async function status() {
    const [rows] = await pool.execute("SELECT 1 AS configured FROM owner_accounts WHERE id = 1");
    return { setupRequired: rows.length === 0 };
  }

  return { setup, login, resetPassword, logout, status, validate };
}

module.exports = { AuthError, createAuth, createMySqlAuth };

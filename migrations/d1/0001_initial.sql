CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL
);

INSERT OR IGNORE INTO app_state (id, version, data)
VALUES (
  1,
  1,
  '{"settings":{"storeName":"BURNICO SARI-SARI Store","currency":"PHP"},"customers":[],"applications":[],"transactions":[]}'
);

CREATE TABLE IF NOT EXISTS owner_accounts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES owner_accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON owner_sessions (expires_at);

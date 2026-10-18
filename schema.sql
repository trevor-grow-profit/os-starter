PRAGMA foreign_keys = ON;

-- Who can sign in. The first user is created by tools/bootstrap-owner.mjs.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  owner INTEGER NOT NULL DEFAULT 0 CHECK (owner IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(owner) WHERE owner = 1;

-- Passkeys (Face ID, Touch ID, Windows Hello, a security key). No passwords anywhere.
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS challenges (
  challenge TEXT PRIMARY KEY,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('authentication','registration')),
  user_id TEXT REFERENCES users(id),
  setup_hash TEXT,
  expires_at TEXT NOT NULL
);

-- One-use links that let a user register their first passkey.
CREATE TABLE IF NOT EXISTS setup_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  source TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

-- Example data table behind the Tasks tab. Copy this pattern for your own tabs.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_user ON tasks(user_id, done, created_at);

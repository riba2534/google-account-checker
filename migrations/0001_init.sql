-- Users and sessions -----------------------------------------------------------

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- id is the SHA-256 hex of the cookie token; the token itself is never stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Failed login counter per key (e.g. "u:<lowercased username>").
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Tasks and cards ---------------------------------------------------------------

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  total INTEGER NOT NULL,
  ok_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_tasks_user ON tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

-- secret holds the AES-GCM sealed CardSecret JSON (raw line, RT, password, TOTP).
-- Everything else is safe to show the owner in masked form.
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('rule', 'ai')),
  email TEXT,
  rt_prefix TEXT NOT NULL,
  has_password INTEGER NOT NULL DEFAULT 0,
  has_totp INTEGER NOT NULL DEFAULT 0,
  secret TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'checking', 'ok', 'failed')),
  category TEXT,
  reason TEXT,
  tier TEXT,
  project TEXT,
  models TEXT,
  quota REAL,
  quota_reset TEXT,
  rt_changed INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  checked_at INTEGER,
  UNIQUE (task_id, idx)
);
CREATE INDEX idx_cards_task_state ON cards(task_id, state);
CREATE INDEX idx_cards_user ON cards(user_id, created_at DESC);

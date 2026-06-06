-- ORACLEX Mail Engine — D1 Schema
-- Run: wrangler d1 execute oraclex-db --file=schema.sql

CREATE TABLE IF NOT EXISTS developers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
);

CREATE TABLE IF NOT EXISTS smtp_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  app_password TEXT NOT NULL,
  sender_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  daily_sent_count INTEGER NOT NULL DEFAULT 0,
  max_daily_limit INTEGER NOT NULL DEFAULT 500,
  last_used_timestamp INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  developer_id INTEGER NOT NULL,
  to_address TEXT NOT NULL,
  template TEXT NOT NULL,
  sender_name TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  smtp_pool_id INTEGER,
  error_message TEXT,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
  sent_at INTEGER,
  FOREIGN KEY (developer_id) REFERENCES developers(id),
  FOREIGN KEY (smtp_pool_id) REFERENCES smtp_pool(id)
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  developer_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'sent,failed',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
  FOREIGN KEY (developer_id) REFERENCES developers(id)
);

-- Default developer API key for testing
INSERT OR IGNORE INTO developers (name, api_key, status)
VALUES ('ORACLEX Test', 'oraclex_live_test_key_xyz123', 'active');

-- Example SMTP pool entry (replace with real credentials before deploying)
-- INSERT OR IGNORE INTO smtp_pool (email, app_password, sender_name)
-- VALUES ('your-gmail@gmail.com', 'your-app-password', 'ORACLEX Master Control');

-- ═══════════════════════════════════════════════════════════════════════════════
-- ORACLEX Mail Engine v2 — D1 Schema
-- Novu-inspired: subscribers, execution_details, activity feed
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run (local):  wrangler d1 execute oraclex-db --file=schema.sql
-- Run (remote): wrangler d1 execute oraclex-db --remote --file=schema.sql

-- ─── Developers (API key store) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS developers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  api_key    TEXT    NOT NULL UNIQUE,
  status     TEXT    NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
);

-- ─── SMTP relay pool (Gmail rotation matrix) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS smtp_pool (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT    NOT NULL UNIQUE,
  app_password         TEXT    NOT NULL,
  sender_name          TEXT,
  status               TEXT    NOT NULL DEFAULT 'active',
  daily_sent_count     INTEGER NOT NULL DEFAULT 0,
  max_daily_limit      INTEGER NOT NULL DEFAULT 500,
  last_used_timestamp  INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch('now'))
);

-- ─── Subscribers (Novu subscriber model — contact store) ──────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  developer_id  INTEGER NOT NULL,
  subscriber_id TEXT    NOT NULL,
  email         TEXT,
  phone         TEXT,
  first_name    TEXT,
  last_name     TEXT,
  avatar        TEXT,
  data          TEXT    DEFAULT '{}',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('now')),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now')),
  UNIQUE(developer_id, subscriber_id),
  FOREIGN KEY (developer_id) REFERENCES developers(id)
);

-- ─── Emails (notification job log) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT    NOT NULL UNIQUE,
  transaction_id TEXT,
  developer_id  INTEGER NOT NULL,
  subscriber_id TEXT,
  to_address    TEXT    NOT NULL,
  template      TEXT    NOT NULL,
  sender_name   TEXT,
  data          TEXT    NOT NULL DEFAULT '{}',
  status        TEXT    NOT NULL DEFAULT 'queued',
  smtp_pool_id  INTEGER,
  error_message TEXT,
  queued_at     INTEGER NOT NULL DEFAULT (unixepoch('now')),
  sent_at       INTEGER,
  FOREIGN KEY (developer_id) REFERENCES developers(id),
  FOREIGN KEY (smtp_pool_id) REFERENCES smtp_pool(id)
);

-- ─── Execution details (Novu ExecutionDetails — per-step trace) ───────────────
CREATE TABLE IF NOT EXISTS execution_details (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id   INTEGER NOT NULL,
  status     TEXT    NOT NULL,
  detail     TEXT    NOT NULL,
  channel    TEXT    NOT NULL DEFAULT 'email',
  raw        TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
  FOREIGN KEY (email_id) REFERENCES emails(id)
);

-- ─── Webhooks ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  developer_id INTEGER NOT NULL,
  url          TEXT    NOT NULL,
  events       TEXT    NOT NULL DEFAULT 'sent,failed',
  status       TEXT    NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('now')),
  FOREIGN KEY (developer_id) REFERENCES developers(id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emails_developer_status   ON emails(developer_id, status);
CREATE INDEX IF NOT EXISTS idx_emails_message_id         ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_subscriber         ON emails(developer_id, subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_developer     ON subscribers(developer_id);
CREATE INDEX IF NOT EXISTS idx_execution_email           ON execution_details(email_id);
CREATE INDEX IF NOT EXISTS idx_smtp_pool_lru             ON smtp_pool(status, daily_sent_count, last_used_timestamp);

-- ─── Default test developer ───────────────────────────────────────────────────
INSERT OR IGNORE INTO developers (name, api_key, status)
VALUES ('ORACLEX Test', 'oraclex_live_test_key_xyz123', 'active');

-- ─── Relay pool seeding: see seed-relay.sql (gitignored) ─────────────────────
-- Do NOT commit real credentials here.
-- Run: wrangler d1 execute oraclex-db [--remote] --file=seed-relay.sql

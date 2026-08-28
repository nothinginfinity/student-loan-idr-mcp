-- V0.8.2 advisor/manager workspace persistence.
-- Raw StudentAid files, raw evidence files, session tokens, and plaintext passwords are intentionally not stored.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS advisor_accounts (
  advisor_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advisor_sessions (
  session_hash TEXT PRIMARY KEY,
  advisor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (advisor_id) REFERENCES advisor_accounts(advisor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_sessions_owner
  ON advisor_sessions(advisor_id, expires_at);

CREATE TABLE IF NOT EXISTS advisor_clients (
  owner_advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active', 'awaiting_borrower_review', 'completed', 'archived')),
  readiness_state TEXT NOT NULL CHECK (readiness_state IN ('needs_evidence', 'document_ready', 'application_ready')),
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_advisor_id, client_id),
  FOREIGN KEY (owner_advisor_id) REFERENCES advisor_accounts(advisor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_clients_owner_updated
  ON advisor_clients(owner_advisor_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_advisor_clients_owner_display
  ON advisor_clients(owner_advisor_id, display_name);

CREATE TABLE IF NOT EXISTS advisor_auth_failures (
  identifier_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS advisor_audit_events (
  event_id TEXT PRIMARY KEY,
  advisor_id TEXT NOT NULL,
  client_id TEXT,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_advisor_audit_owner_created
  ON advisor_audit_events(advisor_id, created_at DESC);

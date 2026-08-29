-- V0.9.1: borrower plan-selection, soft-sign, and booking lifecycle for the
-- chart-first share link. One row per generated share link. share_token is
-- never stored in plaintext -- only its SHA-256 hash, matching the existing
-- advisor_sessions token-hashing convention.

CREATE TABLE IF NOT EXISTS advisor_client_plan_selections (
  selection_id TEXT PRIMARY KEY,
  owner_advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  share_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('issued', 'opened', 'selected', 'signed', 'booked', 'expired', 'revoked')) DEFAULT 'issued',
  comparison_snapshot_json TEXT NOT NULL,
  selected_plan TEXT,
  selected_at TEXT,
  sign_initials TEXT,
  signed_at TEXT,
  booking_url TEXT,
  booked_at TEXT,
  link_opened_at TEXT,
  select_sign_deadline_at TEXT,
  booking_deadline_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_advisor_id, client_id)
    REFERENCES advisor_clients(owner_advisor_id, client_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_plan_selections_owner_client
  ON advisor_client_plan_selections(owner_advisor_id, client_id, created_at DESC);

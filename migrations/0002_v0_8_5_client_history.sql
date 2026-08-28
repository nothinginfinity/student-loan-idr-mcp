-- V0.8.5 retained client artifacts and calculation history.
-- Only explicitly retained generated/normalized artifacts are stored here.
-- Raw StudentAid downloads and raw evidence files remain outside server persistence.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS advisor_client_artifacts (
  owner_advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('document_draft')),
  name TEXT NOT NULL,
  template_request_json TEXT NOT NULL,
  document_text TEXT NOT NULL,
  document_html TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_advisor_id, client_id, artifact_id),
  FOREIGN KEY (owner_advisor_id, client_id)
    REFERENCES advisor_clients(owner_advisor_id, client_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_artifacts_owner_client_created
  ON advisor_client_artifacts(owner_advisor_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS advisor_client_calculation_snapshots (
  owner_advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('calculation', 'comparison')),
  name TEXT NOT NULL,
  basis_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  policy_snapshot TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_advisor_id, client_id, snapshot_id),
  FOREIGN KEY (owner_advisor_id, client_id)
    REFERENCES advisor_clients(owner_advisor_id, client_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_snapshots_owner_client_created
  ON advisor_client_calculation_snapshots(owner_advisor_id, client_id, created_at DESC);

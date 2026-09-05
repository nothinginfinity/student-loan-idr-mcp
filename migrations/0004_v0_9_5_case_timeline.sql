CREATE TABLE IF NOT EXISTS advisor_client_timeline_events (
  owner_advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('calculation','comparison','document_generated','document_retained','document_regenerated','plan_selected','plan_confirmed')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
  source_type TEXT,
  source_id TEXT,
  basis_json TEXT,
  result_json TEXT,
  policy_snapshot TEXT,
  engine_version TEXT NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1)),
  annotation TEXT CHECK(annotation IS NULL OR length(annotation) <= 2000),
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_advisor_id, client_id, event_id),
  FOREIGN KEY (owner_advisor_id, client_id)
    REFERENCES advisor_clients(owner_advisor_id, client_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_client_timeline_events_owner_client_time
  ON advisor_client_timeline_events(owner_advisor_id, client_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_advisor_client_timeline_events_owner_client_starred
  ON advisor_client_timeline_events(owner_advisor_id, client_id, starred DESC, occurred_at DESC);

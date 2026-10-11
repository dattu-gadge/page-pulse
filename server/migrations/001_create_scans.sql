CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL,
  submitted_url TEXT NOT NULL,
  score INTEGER NOT NULL,
  scan JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS scans_scanned_at_idx ON scans (scanned_at DESC);

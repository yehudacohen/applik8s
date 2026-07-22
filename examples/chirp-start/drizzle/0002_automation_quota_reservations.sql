ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS reserved_units text DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS quota_window text DEFAULT '' NOT NULL;

CREATE INDEX IF NOT EXISTS automation_runs_quota_window
  ON automation_runs (automation_id, quota_window);

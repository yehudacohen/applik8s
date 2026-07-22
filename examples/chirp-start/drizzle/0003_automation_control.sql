CREATE TABLE IF NOT EXISTS automation_controls (
  id text PRIMARY KEY,
  enabled text DEFAULT 'true' NOT NULL,
  reason text DEFAULT '' NOT NULL,
  changed_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);

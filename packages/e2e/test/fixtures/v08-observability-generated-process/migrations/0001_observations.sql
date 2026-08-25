CREATE TABLE IF NOT EXISTS v08_observability_process_observations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  label text NOT NULL,
  revision text NOT NULL DEFAULT ''
);

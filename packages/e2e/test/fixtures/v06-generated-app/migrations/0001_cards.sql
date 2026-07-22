CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL,
  revision text NOT NULL DEFAULT ''
);

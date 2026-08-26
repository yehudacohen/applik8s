CREATE TABLE IF NOT EXISTS v08_observability_agent_posts (
  id uuid PRIMARY KEY,
  body text NOT NULL,
  state text NOT NULL,
  revision text NOT NULL DEFAULT ''
);

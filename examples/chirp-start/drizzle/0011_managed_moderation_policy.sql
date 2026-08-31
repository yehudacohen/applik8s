CREATE TABLE IF NOT EXISTS moderation_policies (
  id text PRIMARY KEY,
  max_risk real NOT NULL CHECK (max_risk >= 0 AND max_risk <= 1),
  blocked_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision text NOT NULL DEFAULT ''
);

INSERT INTO moderation_policies (id, max_risk, blocked_terms, revision)
VALUES ('default', 0.8, '[]'::jsonb, '')
ON CONFLICT (id) DO NOTHING;

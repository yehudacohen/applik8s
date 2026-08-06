INSERT INTO automation_controls (
  id,
  enabled,
  reason,
  changed_at,
  revision
)
VALUES (
  'global',
  'true',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

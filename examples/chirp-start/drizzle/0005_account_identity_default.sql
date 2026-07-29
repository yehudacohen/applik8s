-- Existing installations predate principal-derived account registration.
-- The gateway establishes this transaction-local setting; browser input never
-- selects the authoritative account identity.
ALTER TABLE accounts
  ALTER COLUMN id SET DEFAULT nullif(current_setting('applik8s.principal.id', true), '');

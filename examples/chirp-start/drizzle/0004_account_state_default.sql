-- Repair installations created from the original Chirp baseline, whose SQL
-- default accidentally diverged from the authoritative Drizzle declaration.
ALTER TABLE accounts
  ALTER COLUMN state SET DEFAULT 'active';

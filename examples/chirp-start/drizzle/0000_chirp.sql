CREATE TABLE accounts (
  id text PRIMARY KEY,
  handle text NOT NULL,
  display_name text NOT NULL,
  bio text DEFAULT '' NOT NULL,
  avatar_object_key text,
  visibility text DEFAULT 'public' NOT NULL,
  kind text DEFAULT 'human' NOT NULL,
  state text DEFAULT 'saved' NOT NULL,
  joined_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX accounts_handle ON accounts (handle);
CREATE INDEX accounts_state_kind ON accounts (state, kind);

CREATE TABLE credential_links (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  linked_at text NOT NULL,
  revision text NOT NULL
);
CREATE UNIQUE INDEX credential_links_issuer_subject ON credential_links (issuer, subject);
CREATE INDEX credential_links_account ON credential_links (account_id);

CREATE TABLE installation_settings (
  id text PRIMARY KEY,
  site_name text NOT NULL,
  description text NOT NULL,
  registration text NOT NULL,
  default_visibility text NOT NULL,
  media_enabled text NOT NULL,
  automation_enabled text NOT NULL,
  revision text NOT NULL
);

CREATE TABLE posts (
  id text PRIMARY KEY,
  author_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  author_handle text DEFAULT '' NOT NULL,
  body text NOT NULL,
  reply_to_post_id text,
  quote_post_id text,
  visibility text DEFAULT 'public' NOT NULL,
  publication_state text DEFAULT 'published' NOT NULL,
  moderation_state text DEFAULT 'visible' NOT NULL,
  moderation_reason text,
  moderation_changed_at text,
  published_at text DEFAULT '' NOT NULL,
  deleted_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX posts_author_published ON posts (author_id, published_at);
CREATE INDEX posts_reply_published ON posts (reply_to_post_id, published_at);
CREATE INDEX posts_visibility_state ON posts (visibility, publication_state, moderation_state);

CREATE TABLE media_attachments (
  id text PRIMARY KEY,
  owner_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  post_id text REFERENCES posts(id),
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_length text NOT NULL,
  sha256 text NOT NULL,
  alt_text text NOT NULL,
  processing_state text DEFAULT 'pending' NOT NULL,
  created_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX media_attachments_owner ON media_attachments (owner_id, created_at);
CREATE INDEX media_attachments_post ON media_attachments (post_id);

CREATE TABLE follows (
  id text PRIMARY KEY,
  follower_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  followee_id text NOT NULL REFERENCES accounts(id),
  state text DEFAULT 'active' NOT NULL,
  followed_at text DEFAULT '' NOT NULL,
  deleted_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX follows_pair ON follows (follower_id, followee_id);
CREATE INDEX follows_follower_state ON follows (follower_id, state);
CREATE INDEX follows_followee_state ON follows (followee_id, state);

CREATE TABLE reactions (
  id text PRIMARY KEY,
  account_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  post_id text NOT NULL REFERENCES posts(id),
  kind text NOT NULL,
  state text DEFAULT 'active' NOT NULL,
  reacted_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX reactions_account_post_kind ON reactions (account_id, post_id, kind);
CREATE INDEX reactions_post_kind_state ON reactions (post_id, kind, state);

CREATE TABLE bookmarks (
  id text PRIMARY KEY,
  account_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  post_id text NOT NULL REFERENCES posts(id),
  saved_at text DEFAULT '' NOT NULL,
  state text DEFAULT 'saved' NOT NULL,
  deleted_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX bookmarks_account_post ON bookmarks (account_id, post_id);
CREATE INDEX bookmarks_account_saved ON bookmarks (account_id, saved_at);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES accounts(id),
  actor_id text REFERENCES accounts(id),
  post_id text REFERENCES posts(id),
  kind text NOT NULL,
  summary text NOT NULL,
  created_at text NOT NULL,
  read_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX notifications_recipient_created ON notifications (recipient_id, created_at);

CREATE TABLE blocks (
  id text PRIMARY KEY,
  blocker_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  blocked_id text NOT NULL REFERENCES accounts(id),
  created_at text DEFAULT '' NOT NULL,
  state text DEFAULT 'active' NOT NULL,
  deleted_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX blocks_pair ON blocks (blocker_id, blocked_id);

CREATE TABLE mutes (
  id text PRIMARY KEY,
  muter_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  muted_id text NOT NULL REFERENCES accounts(id),
  created_at text DEFAULT '' NOT NULL,
  expires_at text,
  state text DEFAULT 'active' NOT NULL,
  deleted_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE UNIQUE INDEX mutes_pair ON mutes (muter_id, muted_id);

CREATE TABLE reports (
  id text PRIMARY KEY,
  reporter_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  post_id text REFERENCES posts(id),
  account_id text REFERENCES accounts(id),
  reason text NOT NULL,
  detail text NOT NULL,
  state text DEFAULT 'open' NOT NULL,
  created_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX reports_state_created ON reports (state, created_at);

CREATE TABLE moderation_cases (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES reports(id),
  assignee_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') REFERENCES accounts(id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  state text DEFAULT 'open' NOT NULL,
  resolution text,
  opened_at text DEFAULT '' NOT NULL,
  resolved_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX moderation_cases_state_opened ON moderation_cases (state, opened_at);

CREATE TABLE automations (
  id text PRIMARY KEY,
  owner_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL REFERENCES accounts(id),
  account_id text NOT NULL REFERENCES accounts(id),
  persona text NOT NULL,
  instructions text NOT NULL,
  schedule text NOT NULL,
  generation_profile text NOT NULL,
  max_posts_per_day text NOT NULL,
  max_units_per_day text NOT NULL,
  state text DEFAULT 'active' NOT NULL,
  created_at text DEFAULT '' NOT NULL,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX automations_owner_state ON automations (owner_id, state);
CREATE INDEX automations_account ON automations (account_id);

CREATE TABLE automation_runs (
  id text PRIMARY KEY,
  automation_id text NOT NULL REFERENCES automations(id),
  scheduled_for text NOT NULL,
  state text DEFAULT 'pending' NOT NULL,
  published_post_id text,
  usage_units text DEFAULT '0' NOT NULL,
  result_reference text,
  started_at text,
  finished_at text,
  revision text DEFAULT '' NOT NULL
);
CREATE INDEX automation_runs_automation_schedule ON automation_runs (automation_id, scheduled_for);

-- Deterministic starter-site seed. Production registration still flows through
-- Account.register; these rows make the published example immediately usable.
INSERT INTO accounts (id, handle, display_name, bio, visibility, kind, state, joined_at, revision) VALUES
  ('demo-user', 'demo-user', 'Demo User', 'Building a real social application from one typed graph.', 'public', 'human', 'active', '2026-07-17T12:00:00.000Z', 'seed-account-demo'),
  ('ada', 'ada', 'Ada', 'Distributed systems, type systems, and tiny delightful tools.', 'public', 'human', 'active', '2026-07-17T12:00:00.000Z', 'seed-account-ada'),
  ('chirp-ops', 'chirp-ops', 'Chirp Operations', 'Automated, disclosed site-health updates.', 'public', 'automation', 'active', '2026-07-17T12:00:00.000Z', 'seed-account-ops');

INSERT INTO follows (id, follower_id, followee_id, state, followed_at, deleted_at, revision) VALUES
  ('seed-follow-ada', 'demo-user', 'ada', 'active', '2026-07-17T12:02:00.000Z', NULL, 'seed-follow-ada'),
  ('seed-follow-ops', 'demo-user', 'chirp-ops', 'active', '2026-07-17T12:02:01.000Z', NULL, 'seed-follow-ops');

INSERT INTO posts (id, author_id, author_handle, body, reply_to_post_id, quote_post_id, visibility, publication_state, moderation_state, published_at, deleted_at, revision) VALUES
  ('seed-post-welcome', 'ada', 'ada', 'Welcome to Chirp. The feed you are reading is an authorized PostgreSQL view; publication events drive live invalidation and rebuildable analytics.', NULL, NULL, 'public', 'published', 'visible', '2026-07-17T12:05:00.000Z', NULL, 'seed-post-welcome'),
  ('seed-post-ops', 'chirp-ops', 'chirp-ops', 'Site healthy: application host, gateway, event replay, analytical projection, workflows, and media capabilities are declared in one installable graph.', NULL, NULL, 'public', 'published', 'visible', '2026-07-17T12:06:00.000Z', NULL, 'seed-post-ops');

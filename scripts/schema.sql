CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL,
  pin_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('nurse', 'head_nurse')),
  display_name text NOT NULL,
  participant_code text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS users_participant_uq ON users (participant_code);

CREATE TABLE IF NOT EXISTS shifts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  type text NOT NULL,
  started_at bigint NOT NULL,
  ended_at bigint,
  summary jsonb
);
CREATE INDEX IF NOT EXISTS shifts_user_idx ON shifts (user_id);
CREATE INDEX IF NOT EXISTS shifts_started_idx ON shifts (started_at);

CREATE TABLE IF NOT EXISTS beds (
  id text PRIMARY KEY,
  shift_id text NOT NULL REFERENCES shifts(id),
  label text NOT NULL,
  alias text NOT NULL
);
CREATE INDEX IF NOT EXISTS beds_shift_idx ON beds (shift_id);

CREATE TABLE IF NOT EXISTS task_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  tier integer NOT NULL,
  interval_min integer NOT NULL,
  expected_min integer NOT NULL,
  offset_min integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  shift_id text NOT NULL,
  bed_id text,
  task_id text,
  actor_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  client_ts bigint NOT NULL,
  server_ts bigint NOT NULL,
  server_seq bigserial NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_server_seq_uq ON events (server_seq);
CREATE INDEX IF NOT EXISTS events_shift_idx ON events (shift_id);
CREATE INDEX IF NOT EXISTS events_actor_idx ON events (actor_id);

CREATE TABLE IF NOT EXISTS handover_reports (
  id text PRIMARY KEY,
  shift_id text NOT NULL,
  bed_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS handovers_shift_idx ON handover_reports (shift_id);

CREATE TABLE IF NOT EXISTS shift_reviews (
  id text PRIMARY KEY,
  shift_id text NOT NULL,
  nurse_id text NOT NULL,
  reviewer_id text NOT NULL,
  scores jsonb NOT NULL,
  comment text NOT NULL DEFAULT '',
  needs_support boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_shift_uq ON shift_reviews (shift_id);
CREATE INDEX IF NOT EXISTS reviews_nurse_idx ON shift_reviews (nurse_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  participant_code text NOT NULL,
  instrument text NOT NULL,
  phase text NOT NULL,
  answers jsonb NOT NULL,
  score text NOT NULL,
  taken_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_instrument_idx ON survey_responses (instrument);

CREATE TABLE IF NOT EXISTS config (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

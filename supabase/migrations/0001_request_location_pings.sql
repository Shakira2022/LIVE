-- ---------------------------------------------------------------------------
-- OPTIONAL, ADDITIVE MIGRATION - live responder/requester tracking
-- Block 4 (Persons 3-6). Discuss in the Monday sync before running.
--
-- WHY THIS EXISTS
--   supabase/schema.sql models request_locations as ONE row per request
--   (`request_id uuid not null UNIQUE`). That is correct for "where is the
--   incident", and lib/middleware/server/requests-service.ts upserts into it.
--
--   It cannot store a TRAIL. Continuous tracking ("the responder is 4 minutes
--   away, moving") needs many rows per request over time.
--
-- This migration ADDS a table. It does not alter or drop anything that already
-- exists, so nothing the backend or frontend team has built can break.
-- If the team decides live tracking is out of scope for Version 0.1, do not run
-- this file - record it under deferred features instead (Block 8, Person 9).
-- ---------------------------------------------------------------------------

create table if not exists request_location_pings (
  id             bigserial primary key,
  request_id     uuid not null references emergency_requests(id) on delete cascade,
  reported_by    uuid references users(id) on delete set null,
  actor_kind     varchar(20) not null default 'requester',
  latitude       numeric(10, 7) not null check (latitude between -90 and 90),
  longitude      numeric(10, 7) not null check (longitude between -180 and 180),
  accuracy_meters numeric(8, 2),
  heading_degrees numeric(5, 2) check (heading_degrees is null or heading_degrees between 0 and 360),
  speed_mps      numeric(6, 2) check (speed_mps is null or speed_mps >= 0),
  captured_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  constraint ping_actor_kind check (actor_kind in ('requester', 'responder'))
);

create index if not exists request_location_pings_request_time_idx
  on request_location_pings (request_id, captured_at desc);

alter table request_location_pings enable row level security;

comment on table request_location_pings is
  'Append-only position trail for an active emergency. request_locations holds '
  'the single confirmed incident location; this holds movement over time.';

-- LIVE emergency-response platform
-- Production-oriented Supabase PostgreSQL schema.
-- The current UI prototype uses browser-local mock data; this schema is the
-- recommended relational model for replacing the mock store.

create extension if not exists pgcrypto;
create extension if not exists citext;

create type app_user_role as enum ('requester', 'dispatcher', 'responder', 'admin', 'auditor', 'support');
create type account_status as enum ('pending', 'active', 'suspended', 'locked', 'deactivated');
create type organisation_type as enum ('hospital', 'emergency_response', 'administration', 'support');
create type organisation_status as enum ('pending', 'active', 'paused', 'suspended', 'closed');
create type membership_status as enum ('invited', 'active', 'suspended', 'removed');
create type emergency_status as enum ('submitted', 'received', 'assigned', 'en_route', 'arrived', 'closed', 'cancelled', 'rejected');
create type emergency_severity as enum ('critical', 'high', 'moderate');
create type location_method as enum ('gps', 'manual', 'map_pin');
create type resource_status as enum ('available', 'assigned', 'en_route', 'on_scene', 'offline', 'maintenance');
create type assignment_status as enum ('assigned', 'acknowledged', 'en_route', 'arrived', 'completed', 'cancelled', 'rejected');
create type notification_channel as enum ('in_app', 'web_push', 'sms', 'email');
create type notification_delivery_status as enum ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled');
create type audit_result as enum ('success', 'denied', 'warning', 'failure');
create type log_level as enum ('debug', 'info', 'warning', 'error', 'critical');
create type integration_status as enum ('not_configured', 'sandbox', 'active', 'degraded', 'disabled');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  phone varchar(32) unique,
  password_hash text not null,
  role app_user_role not null default 'requester',
  status account_status not null default 'pending',
  first_name varchar(100) not null,
  last_name varchar(100) not null,
  display_name varchar(160),
  preferred_contact_method varchar(20) not null default 'phone',
  locale varchar(20) not null default 'en-ZA',
  timezone varchar(64) not null default 'Africa/Johannesburg',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at timestamptz,
  failed_login_attempts integer not null default 0 check (failed_login_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint users_contact_required check (email is not null or phone is not null)
);

create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  full_name varchar(160) not null,
  relationship varchar(80),
  phone varchar(32) not null,
  email citext,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name varchar(220) not null,
  organisation_type organisation_type not null,
  registration_number varchar(100),
  contact_email citext,
  contact_phone varchar(32),
  address_line_1 varchar(220),
  address_line_2 varchar(220),
  suburb varchar(120),
  city varchar(120),
  province varchar(120),
  postal_code varchar(20),
  country_code char(2) not null default 'ZA',
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  service_area_description text not null,
  status organisation_status not null default 'pending',
  integration_status integration_status not null default 'not_configured',
  integration_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  operational_role varchar(100) not null,
  permissions jsonb not null default '[]'::jsonb,
  status membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create table responder_teams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name varchar(160) not null,
  code varchar(40),
  description text,
  status resource_status not null default 'available',
  base_latitude numeric(10, 7),
  base_longitude numeric(10, 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table responder_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  organisation_id uuid not null references organisations(id) on delete restrict,
  employee_number varchar(80),
  qualification varchar(160),
  licence_number varchar(120),
  availability resource_status not null default 'offline',
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  location_accuracy_meters numeric(8, 2),
  last_location_at timestamptz,
  shift_started_at timestamptz,
  shift_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references responder_teams(id) on delete cascade,
  responder_user_id uuid not null references responder_profiles(user_id) on delete cascade,
  team_role varchar(80) not null default 'member',
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (team_id, responder_user_id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  registration_number varchar(40) not null,
  call_sign varchar(80),
  vehicle_type varchar(100) not null,
  status resource_status not null default 'available',
  capacity integer check (capacity is null or capacity > 0),
  equipment jsonb not null default '[]'::jsonb,
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  last_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, registration_number)
);

create table emergency_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code varchar(40) not null unique,
  requester_id uuid not null references users(id) on delete restrict,
  routed_organisation_id uuid references organisations(id) on delete set null,
  emergency_contact_id uuid references emergency_contacts(id) on delete set null,
  category varchar(120) not null,
  severity emergency_severity not null,
  note text,
  callback_number varchar(32) not null,
  current_status emergency_status not null default 'submitted',
  is_active boolean not null default true,
  is_cancelled boolean not null default false,
  source varchar(40) not null default 'responsive_web',
  idempotency_key varchar(120) not null unique,
  duplicate_fingerprint varchar(160),
  device_identifier_hash varchar(180),
  client_request_id varchar(120),
  estimated_arrival_at timestamptz,
  eta_minutes integer check (eta_minutes is null or eta_minutes >= 0),
  submitted_at timestamptz not null default now(),
  received_at timestamptz,
  assigned_at timestamptz,
  en_route_at timestamptz,
  arrived_at timestamptz,
  closed_at timestamptz,
  cancellation_requested_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table request_locations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references emergency_requests(id) on delete cascade,
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  accuracy_meters numeric(8, 2),
  address_text text,
  landmark text,
  location_method location_method not null,
  captured_at timestamptz not null,
  confirmed_at timestamptz,
  reverse_geocode_provider varchar(120),
  route_provider varchar(120),
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references emergency_requests(id) on delete cascade,
  previous_status emergency_status,
  new_status emergency_status not null,
  changed_by_user_id uuid references users(id) on delete set null,
  actor_role app_user_role,
  changed_by_system boolean not null default false,
  reason varchar(220),
  note text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table request_assignments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references emergency_requests(id) on delete cascade,
  organisation_id uuid not null references organisations(id) on delete restrict,
  team_id uuid references responder_teams(id) on delete set null,
  responder_user_id uuid references responder_profiles(user_id) on delete set null,
  vehicle_id uuid references vehicles(id) on delete set null,
  assigned_by_user_id uuid not null references users(id) on delete restrict,
  status assignment_status not null default 'assigned',
  eta_minutes integer check (eta_minutes is null or eta_minutes >= 0),
  assignment_note text,
  assigned_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  route_started_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table operational_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references emergency_requests(id) on delete cascade,
  author_user_id uuid not null references users(id) on delete restrict,
  note text not null,
  requester_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references emergency_requests(id) on delete cascade,
  uploaded_by_user_id uuid not null references users(id) on delete restrict,
  storage_bucket varchar(120) not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type varchar(160) not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  checksum_sha256 varchar(64),
  requester_visible boolean not null default false,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references users(id) on delete cascade,
  request_id uuid references emergency_requests(id) on delete cascade,
  notification_type varchar(100) not null,
  title varchar(180) not null,
  message text not null,
  sensitivity varchar(30) not null default 'normal',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  expires_at timestamptz
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  channel notification_channel not null,
  destination_masked varchar(180),
  status notification_delivery_status not null default 'queued',
  provider_name varchar(120),
  provider_message_id varchar(180),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);

create table device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_identifier_hash varchar(180) not null,
  device_name varchar(160),
  platform varchar(100),
  browser varchar(100),
  user_agent text,
  ip_address inet,
  jwt_id_hash varchar(180) not null,
  refresh_token_hash varchar(180),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create table password_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash varchar(180) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip inet,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  actor_role app_user_role,
  organisation_id uuid references organisations(id) on delete set null,
  action varchar(180) not null,
  target_type varchar(120) not null,
  target_id varchar(180),
  request_id uuid references emergency_requests(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  result audit_result not null,
  ip_address inet,
  user_agent text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table security_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  event_type varchar(160) not null,
  result audit_result not null,
  correlation_id uuid not null default gen_random_uuid(),
  ip_address inet,
  user_agent text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table application_logs (
  id uuid primary key default gen_random_uuid(),
  level log_level not null,
  service_name varchar(120) not null,
  event_name varchar(160) not null,
  message text not null,
  request_id uuid references emergency_requests(id) on delete set null,
  correlation_id uuid,
  error_code varchar(120),
  safe_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table external_integrations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  provider_type varchar(100) not null,
  provider_name varchar(160) not null,
  status integration_status not null default 'not_configured',
  base_url text,
  credential_secret_reference text,
  settings jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table integration_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references external_integrations(id) on delete set null,
  organisation_id uuid references organisations(id) on delete set null,
  request_id uuid references emergency_requests(id) on delete set null,
  provider_name varchar(160) not null,
  operation varchar(160) not null,
  endpoint_name varchar(180),
  http_status integer,
  result audit_result not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  attempt_number integer not null default 1 check (attempt_number > 0),
  error_message text,
  correlation_id uuid not null default gen_random_uuid(),
  safe_request_metadata jsonb not null default '{}'::jsonb,
  safe_response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table system_settings (
  setting_key varchar(160) primary key,
  setting_value jsonb not null,
  description text,
  is_public boolean not null default false,
  updated_by_user_id uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Important search and operational indexes.
create index users_role_status_idx on users(role, status);
create index organisations_status_idx on organisations(status, organisation_type);
create index organisation_members_user_idx on organisation_members(user_id, status);
create index responders_org_availability_idx on responder_profiles(organisation_id, availability);
create index vehicles_org_status_idx on vehicles(organisation_id, status);
create index emergency_requests_active_idx on emergency_requests(is_active, current_status, submitted_at desc);
create index emergency_requests_requester_idx on emergency_requests(requester_id, submitted_at desc);
create index emergency_requests_org_idx on emergency_requests(routed_organisation_id, current_status, submitted_at desc);
create index emergency_requests_fingerprint_idx on emergency_requests(duplicate_fingerprint) where is_active = true;
create index request_status_history_request_idx on request_status_history(request_id, created_at);
create index request_assignments_request_idx on request_assignments(request_id, assigned_at desc);
create index request_assignments_responder_idx on request_assignments(responder_user_id, status);
create index notifications_recipient_idx on notifications(recipient_user_id, read_at, created_at desc);
create index notification_deliveries_retry_idx on notification_deliveries(status, next_retry_at);
create index device_sessions_user_active_idx on device_sessions(user_id, revoked_at, expires_at);
create index audit_logs_created_idx on audit_logs(created_at desc);
create index audit_logs_actor_idx on audit_logs(actor_user_id, created_at desc);
create index audit_logs_request_idx on audit_logs(request_id, created_at desc);
create index security_logs_user_idx on security_logs(user_id, created_at desc);
create index application_logs_level_idx on application_logs(level, created_at desc);
create index integration_logs_request_idx on integration_logs(request_id, created_at desc);

-- Updated-at triggers.
create trigger users_set_updated_at before update on users for each row execute function set_updated_at();
create trigger emergency_contacts_set_updated_at before update on emergency_contacts for each row execute function set_updated_at();
create trigger organisations_set_updated_at before update on organisations for each row execute function set_updated_at();
create trigger organisation_members_set_updated_at before update on organisation_members for each row execute function set_updated_at();
create trigger responder_teams_set_updated_at before update on responder_teams for each row execute function set_updated_at();
create trigger responder_profiles_set_updated_at before update on responder_profiles for each row execute function set_updated_at();
create trigger vehicles_set_updated_at before update on vehicles for each row execute function set_updated_at();
create trigger emergency_requests_set_updated_at before update on emergency_requests for each row execute function set_updated_at();
create trigger request_locations_set_updated_at before update on request_locations for each row execute function set_updated_at();
create trigger request_assignments_set_updated_at before update on request_assignments for each row execute function set_updated_at();
create trigger operational_notes_set_updated_at before update on operational_notes for each row execute function set_updated_at();
create trigger notification_deliveries_set_updated_at before update on notification_deliveries for each row execute function set_updated_at();
create trigger external_integrations_set_updated_at before update on external_integrations for each row execute function set_updated_at();

-- Keep browser clients out of raw tables. The selected architecture sends requests
-- through authenticated Next.js route handlers using a server-side database client.
alter table users enable row level security;
alter table emergency_contacts enable row level security;
alter table organisations enable row level security;
alter table organisation_members enable row level security;
alter table responder_teams enable row level security;
alter table responder_profiles enable row level security;
alter table team_members enable row level security;
alter table vehicles enable row level security;
alter table emergency_requests enable row level security;
alter table request_locations enable row level security;
alter table request_status_history enable row level security;
alter table request_assignments enable row level security;
alter table operational_notes enable row level security;
alter table request_attachments enable row level security;
alter table notifications enable row level security;
alter table notification_deliveries enable row level security;
alter table device_sessions enable row level security;
alter table password_recovery_tokens enable row level security;
alter table audit_logs enable row level security;
alter table security_logs enable row level security;
alter table application_logs enable row level security;
alter table external_integrations enable row level security;
alter table integration_logs enable row level security;
alter table system_settings enable row level security;

-- No permissive direct-client policies are created here. Add narrowly scoped policies
-- only if the project later uses Supabase-authenticated browser access. With custom JWT
-- middleware, use protected Next.js server routes and keep the service-role key server-only.

-- Dispatchers may monitor emergency and responder locations from the
-- operations map. Location writes remain server-controlled.

alter table public.request_locations enable row level security;
alter table public.responder_profiles enable row level security;

drop policy if exists "Dispatchers can view request locations" on public.request_locations;
create policy "Dispatchers can view request locations"
on public.request_locations
for select
using (auth.jwt() ->> 'role' = 'dispatcher');

drop policy if exists "Dispatchers can view responder locations" on public.responder_profiles;
create policy "Dispatchers can view responder locations"
on public.responder_profiles
for select
using (auth.jwt() ->> 'role' = 'dispatcher');

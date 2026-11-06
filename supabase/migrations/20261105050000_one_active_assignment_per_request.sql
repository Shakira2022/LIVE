-- Keep one active responder assignment per request, including concurrent
-- dispatch attempts. Existing active duplicates must be resolved before this
-- migration is applied; the index intentionally fails instead of deleting data.
create unique index if not exists request_assignments_one_active_per_request
  on public.request_assignments (request_id)
  where status in ('assigned', 'acknowledged', 'en_route', 'arrived');

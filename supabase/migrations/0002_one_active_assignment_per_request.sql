-- Only one active responder may own an emergency request at a time.
-- Historical/completed assignments remain allowed for audit and history.

create unique index if not exists request_assignments_one_active_per_request
  on public.request_assignments (request_id)
  where status in ('assigned', 'acknowledged', 'en_route', 'arrived');



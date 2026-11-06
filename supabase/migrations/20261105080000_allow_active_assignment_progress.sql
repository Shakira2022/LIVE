-- The online guard is intended to prevent assigning a new mission to an
-- offline responder. It must not block status updates on an already-owned
-- mission after the responder moves to en_route or on_scene.
create or replace function public.prevent_offline_responder_assignment()
returns trigger
language plpgsql
as $$
declare
  responder_availability public.resource_status;
begin
  if new.responder_user_id is null
     or new.status not in ('assigned', 'acknowledged', 'en_route', 'arrived') then
    return new;
  end if;

  -- Status/timestamp progression for the same assignment is valid regardless
  -- of the responder's current operational state. Validate only when creating
  -- an assignment or changing who owns it.
  if tg_op = 'UPDATE'
     and old.responder_user_id is not distinct from new.responder_user_id
     and old.request_id is not distinct from new.request_id
     and old.organisation_id is not distinct from new.organisation_id then
    return new;
  end if;

  select availability
    into responder_availability
  from public.responder_profiles
  where user_id = new.responder_user_id;

  if responder_availability is null then
    raise exception 'Responder profile % does not exist', new.responder_user_id;
  end if;

  -- Automatic dispatch claims a responder by changing available -> assigned
  -- immediately before inserting the assignment. Both states are valid here.
  if responder_availability not in ('available', 'assigned') then
    raise exception 'Responder % is not online and cannot receive an assignment', new.responder_user_id;
  end if;

  return new;
end;
$$;

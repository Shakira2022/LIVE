-- When an emergency or assignment is deleted, do not leave the responder
-- profile stuck in an assigned/on-mission state. Keep responders offline so
-- they must explicitly choose Go online before receiving new work.

create or replace function public.release_responder_after_assignment_delete()
returns trigger
language plpgsql
as $$
begin
  if old.responder_user_id is not null
     and not exists (
       select 1
       from public.request_assignments active_assignment
       where active_assignment.responder_user_id = old.responder_user_id
         and active_assignment.status in ('assigned', 'acknowledged', 'en_route', 'arrived')
     ) then
    update public.responder_profiles
    set availability = 'offline'::resource_status,
        updated_at = now()
    where user_id = old.responder_user_id
      and availability in ('assigned', 'en_route', 'on_scene');
  end if;

  return old;
end;
$$;

drop trigger if exists release_responder_after_assignment_delete
on public.request_assignments;

create trigger release_responder_after_assignment_delete
after delete on public.request_assignments
for each row
execute function public.release_responder_after_assignment_delete();

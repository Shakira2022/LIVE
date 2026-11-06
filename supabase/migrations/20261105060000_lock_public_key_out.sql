-- Browser clients use authenticated server routes for public-schema data.
-- The service-role key remains server-only and bypasses RLS. Realtime
-- broadcast channels are separate from these public-table grants.
--
-- Before applying, resolve any existing duplicate active assignments; see
-- 20261105050000_one_active_assignment_per_request.sql.

do $$
declare
  policy_row record;
  table_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;

  for table_row in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', table_row.tablename);
  end loop;
end
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

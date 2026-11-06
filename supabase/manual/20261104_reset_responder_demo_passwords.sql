-- One-time password reset for the Vaal test responder accounts.
-- Passwords are bcrypt-hashed; run this only in the intended Supabase project.
DO $reset$
DECLARE
  amina_password_reset integer;
  thabo_password_reset integer;
BEGIN
  UPDATE public.users
     SET password_hash = '$2b$10$KMPVhkv0HSbYzjVlZNa6we94xT37/a1Deo4BxY8h.Ba3ACE5Um7cW',
         updated_at = NOW()
   WHERE id = 'e51a77a6-5173-4665-aa8d-d2196464cfae'::uuid
     AND email = 'amina.dlamini.vaal@live.test'
     AND role = 'responder'
     AND deleted_at IS NULL;
  GET DIAGNOSTICS amina_password_reset = ROW_COUNT;
  IF amina_password_reset <> 1 THEN
    RAISE EXCEPTION 'Expected one active responder for Amina Dlamini; updated % rows', amina_password_reset;
  END IF;

  UPDATE public.users
     SET password_hash = '$2b$10$ebCnT3nlkIoipXom.MdTau3xO7CDJq80PFi6k7HBHgp17So7TDPe.',
         updated_at = NOW()
   WHERE id = '52451efc-c679-4e8c-b9e4-859a7f95d8fc'::uuid
     AND email = 'thabo.mokoena.vaal@live.test'
     AND role = 'responder'
     AND deleted_at IS NULL;
  GET DIAGNOSTICS thabo_password_reset = ROW_COUNT;
  IF thabo_password_reset <> 1 THEN
    RAISE EXCEPTION 'Expected one active responder for Thabo Mokoena; updated % rows', thabo_password_reset;
  END IF;
END
$reset$;

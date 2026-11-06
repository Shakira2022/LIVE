-- Create the demo requester shown in the login page's demo account picker.
-- Run once in the intended LIVE Supabase project.
DO $create_demo_requester$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE lower(email) = lower('demo.requester@live.test')
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'demo.requester@live.test already exists; no user was changed';
  END IF;

  INSERT INTO public.users (
    first_name,
    last_name,
    display_name,
    email,
    phone,
    password_hash,
    role,
    status
  ) VALUES (
    'Demo',
    'Requester',
    'Demo Requester',
    'demo.requester@live.test',
    '+27 82 555 0199',
    '$2b$10$IwFrM/1Oyw9IoBIV/H5xT.MnMOk1g2CO.EH6aMd18tEIpTUT0Tvcq',
    'requester',
    'active'
  );
END
$create_demo_requester$;

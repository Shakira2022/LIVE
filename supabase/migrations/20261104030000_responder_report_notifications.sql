-- Keep one notification of each type per report and recipient so a dispatcher
-- can receive both the submission receipt and the later resolution update.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS responder_report_id uuid
    REFERENCES public.responder_reports(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.notifications_responder_report_recipient_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_responder_report_recipient_type_uidx
  ON public.notifications (responder_report_id, recipient_user_id, notification_type)
  WHERE responder_report_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_dispatcher_of_report_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  responder_name text;
BEGIN
  SELECT coalesce(
    nullif(trim(display_name), ''),
    nullif(trim(concat_ws(' ', first_name, last_name)), ''),
    email
  )
  INTO responder_name
  FROM public.users
  WHERE id = NEW.responder_user_id;

  INSERT INTO public.notifications (
    recipient_user_id,
    responder_report_id,
    notification_type,
    title,
    message,
    sensitivity
  )
  VALUES (
    NEW.reported_by_user_id,
    NEW.id,
    'responder_report_submitted',
    'Responder report submitted',
    format('Your report about %s was sent to administrators for review.', coalesce(responder_name, 'the responder')),
    'normal'
  )
  ON CONFLICT (responder_report_id, recipient_user_id, notification_type)
    WHERE responder_report_id IS NOT NULL
    DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_dispatcher_of_report_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  responder_name text;
  resolution_outcome text;
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'resolved' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(
    nullif(trim(display_name), ''),
    nullif(trim(concat_ws(' ', first_name, last_name)), ''),
    email
  )
  INTO responder_name
  FROM public.users
  WHERE id = NEW.responder_user_id;

  resolution_outcome := CASE NEW.resolution_action
    WHEN 'suspended' THEN 'the responder was suspended'
    ELSE 'the responder was not suspended'
  END;

  INSERT INTO public.notifications (
    recipient_user_id,
    responder_report_id,
    notification_type,
    title,
    message,
    sensitivity
  )
  VALUES (
    NEW.reported_by_user_id,
    NEW.id,
    'responder_report_resolved',
    'Responder report resolved',
    format('Your report about %s was resolved; %s.', coalesce(responder_name, 'the responder'), resolution_outcome),
    'normal'
  )
  ON CONFLICT (responder_report_id, recipient_user_id, notification_type)
    WHERE responder_report_id IS NOT NULL
    DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS responder_reports_notify_reporter_submission ON public.responder_reports;
CREATE TRIGGER responder_reports_notify_reporter_submission
  AFTER INSERT ON public.responder_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dispatcher_of_report_submission();

DROP TRIGGER IF EXISTS responder_reports_notify_reporter_resolution ON public.responder_reports;
CREATE TRIGGER responder_reports_notify_reporter_resolution
  AFTER UPDATE OF status ON public.responder_reports
  FOR EACH ROW
  WHEN (OLD.status = 'open' AND NEW.status = 'resolved')
  EXECUTE FUNCTION public.notify_dispatcher_of_report_resolution();

REVOKE ALL ON FUNCTION public.notify_dispatcher_of_report_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_dispatcher_of_report_resolution() FROM PUBLIC;

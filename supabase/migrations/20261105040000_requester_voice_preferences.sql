CREATE TABLE IF NOT EXISTS public.requester_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{"voiceGuidance":false,"blindVoiceGuidance":false,"voiceNavigation":false,"voiceCommandsActive":true,"skipIncidentDetails":true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.requester_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requester_preferences_select_own ON public.requester_preferences;
CREATE POLICY requester_preferences_select_own
  ON public.requester_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS requester_preferences_insert_own ON public.requester_preferences;
CREATE POLICY requester_preferences_insert_own
  ON public.requester_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS requester_preferences_update_own ON public.requester_preferences;
CREATE POLICY requester_preferences_update_own
  ON public.requester_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.requester_preferences TO authenticated;

-- =========================================================
-- LIVE Emergency Response System
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================

-- =========================================================
-- ENABLE RLS
-- =========================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;


-- =========================================================
-- 1. USERS
-- Users can only view and update their own profile.
-- =========================================================

CREATE POLICY "Users can view their own profile"
ON public.users
FOR SELECT
USING (auth.uid() = id);


CREATE POLICY "Users can update their own profile"
ON public.users
FOR UPDATE
USING (auth.uid() = id);


-- Allow authenticated users to insert their own profile.
CREATE POLICY "Users can insert themselves"
ON public.users
FOR INSERT
WITH CHECK (auth.uid() = id);


-- =========================================================
-- 2. EMERGENCY REQUESTS
-- Requesters can view their own requests.
-- =========================================================

CREATE POLICY "Requesters can view their own requests"
ON public.emergency_requests
FOR SELECT
USING (
    auth.uid() = requester_id
);


-- Requesters can create their own emergency requests.
CREATE POLICY "Requesters can insert their own request"
ON public.emergency_requests
FOR INSERT
WITH CHECK (
    auth.uid() = requester_id
);


-- Requesters can update their own requests.
CREATE POLICY "Requesters can update their own requests"
ON public.emergency_requests
FOR UPDATE
USING (
    auth.uid() = requester_id
);


-- =========================================================
-- 3. RESPONDER / DISPATCHER ACCESS
-- Responders and dispatchers can view emergency requests.
-- =========================================================

CREATE POLICY "Responders can view active requests"
ON public.emergency_requests
FOR SELECT
USING (
    auth.jwt() ->> 'role' = 'responder'
    OR
    auth.jwt() ->> 'role' = 'dispatcher'
);


-- =========================================================
-- 4. REQUEST STATUS HISTORY
-- Requesters can view history belonging to their requests.
-- =========================================================

CREATE POLICY "Users can view their own history"
ON public.request_status_history
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.emergency_requests
        WHERE emergency_requests.id =
              request_status_history.request_id
        AND emergency_requests.requester_id =
              auth.uid()
    )
);


-- Responders and dispatchers can add status updates.
CREATE POLICY "Responders can update status history"
ON public.request_status_history
FOR INSERT
WITH CHECK (
    auth.jwt() ->> 'role' IN ('responder', 'dispatcher')
);


-- =========================================================
-- 5. ORGANISATIONS
-- Admins can manage organisations.
-- =========================================================

CREATE POLICY "Admins can manage orgs"
ON public.organisations
FOR ALL
USING (
    auth.jwt() ->> 'role' = 'admin'
);


-- Users can view organisation names/details.
CREATE POLICY "Public can view org names"
ON public.organisations
FOR SELECT
USING (true);
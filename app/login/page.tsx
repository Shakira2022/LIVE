"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { DemoAccountPicker } from "@/components/auth/demo-account-picker";
import { TopValidationAlert } from "@/components/ui/top-validation-alert";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";
import { roleHome } from "@/lib/utils";
import { writeFreshCache } from "@/lib/client-cache";
import { managerAnalyticsCacheKey, managerAnalyticsParams, managerDefaultDates } from "@/lib/manager-analytics";

type WarmRequest = {
  id?: string;
  category?: string;
  currentStatus?: string;
  current_status?: string;
  status?: string;
};

type WarmPayload = {
  data?: {
    items?: WarmRequest[];
    notifications?: Array<Record<string, unknown>>;
  };
  items?: WarmRequest[];
  requests?: WarmRequest[];
  notifications?: Array<Record<string, unknown>>;
};

type WarmResponderMission = {
  assignment: Record<string, unknown>;
  request: Record<string, unknown>;
  location: Record<string, unknown> | null;
  statusHistory: unknown[];
  responder: {
    availability?: string;
    current_latitude?: number | null;
    current_longitude?: number | null;
  } | null;
};

type WarmResponderMissionPayload = {
  data?: {
    mission?: WarmResponderMission | null;
    queuedRequests?: unknown[];
    responder?: WarmResponderMission["responder"];
    mapCenter?: { lat: number; lng: number } | null;
  };
  mission?: WarmResponderMission | null;
  queuedRequests?: unknown[];
  responder?: WarmResponderMission["responder"];
  mapCenter?: { lat: number; lng: number } | null;
};

async function warmRequesterCache(userId: string) {
  try {
    const [requestsResult, notificationsResult] = await Promise.allSettled([
      fetch("/api/requests?limit=100&offset=0", {
        credentials: "include",
        cache: "no-store",
      }),
      fetch("/api/notifications", {
        credentials: "include",
        cache: "no-store",
      }),
    ]);

    if (requestsResult.status === "fulfilled" && requestsResult.value.ok) {
      const payload = await requestsResult.value.json() as WarmPayload;
      const requests = payload.data?.items ?? payload.items ?? payload.requests ?? [];
      const active = requests.find((request) =>
        ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"].includes(
          request.currentStatus ?? request.current_status ?? request.status ?? "",
        ),
      );

      writeFreshCache(`requester-history:${userId}`, requests, 5 * 60_000);
      writeFreshCache(
        `requester-active-request:${userId}`,
        { id: active?.id ?? null, category: active?.category ?? null },
        active ? 5 * 60_000 : 30_000,
      );
    }

    if (notificationsResult.status === "fulfilled" && notificationsResult.value.ok) {
      const payload = await notificationsResult.value.json() as WarmPayload;
      const notifications = Array.isArray(payload.data?.notifications)
        ? payload.data.notifications
        : Array.isArray(payload.data?.items)
          ? payload.data.items
          : Array.isArray(payload.notifications)
            ? payload.notifications
            : [];

      writeFreshCache(`requester-notifications:${userId}`, notifications, 5 * 60_000);
    }
  } catch {
    // Login must still complete if a background prefetch response is malformed.
  }
}

async function primeRequesterMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    // This is started immediately after successful sign-in, while the login
    // interaction is still fresh. Requesting permission here lets the
    // post-login mic control start without a second browser permission prompt.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Voice remains available from the header control, which can explain the
    // browser permission requirement if access was denied or unavailable.
  }
}

async function warmResponderCache(userId: string, organisationId?: string | null) {
  try {
    const [historyResult, availabilityResult, missionResult, notificationsResult] = await Promise.allSettled([
      fetch("/api/responder/history", {
        credentials: "include",
        cache: "no-store",
      }),
      fetch("/api/responder/availability", {
        credentials: "include",
        cache: "no-store",
      }),
      fetch("/api/responder/mission", {
        credentials: "include",
        cache: "no-store",
      }),
      fetch("/api/notifications", {
        credentials: "include",
        cache: "no-store",
      }),
    ]);

    // Warm mission and request coordinates first because the responder map
    // needs these to render at the incident as soon as navigation completes.
    if (missionResult.status === "fulfilled" && missionResult.value.ok) {
      const payload = await missionResult.value.json() as WarmResponderMissionPayload;
      const mission = payload.data?.mission ?? payload.mission ?? null;
      const queuedRequests = payload.data?.queuedRequests ?? payload.queuedRequests ?? [];
      const responder = payload.data?.responder ?? payload.responder ?? mission?.responder ?? null;
      const latitude = Number(responder?.current_latitude);
      const longitude = Number(responder?.current_longitude);
      const responderLocation = responder?.current_latitude != null &&
        responder?.current_longitude != null &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        !(latitude === 0 && longitude === 0)
        ? { lat: latitude, lng: longitude }
        : null;

      writeFreshCache(
        `responder-mission-v4:${userId}:${organisationId ?? "unassigned"}`,
        {
          mission,
          queuedRequests,
          responderAvailability: responder?.availability ?? mission?.responder?.availability ?? "offline",
          responderLocation,
          mapCenter: payload.data?.mapCenter ?? payload.mapCenter ?? null,
        },
        mission ? 5 * 60_000 : 30_000,
      );
    }

    if (historyResult.status === "fulfilled" && historyResult.value.ok) {
      const payload = await historyResult.value.json() as {
        data?: { assignments?: unknown[] };
        assignments?: unknown[];
      };
      const assignments = payload.data?.assignments ?? payload.assignments ?? [];
      writeFreshCache(`responder-history:${userId}`, Array.isArray(assignments) ? assignments : [], 5 * 60_000);
    }

    if (availabilityResult.status === "fulfilled" && availabilityResult.value.ok) {
      const payload = await availabilityResult.value.json() as {
        data?: { responder?: Record<string, unknown> } | Record<string, unknown>;
        responder?: Record<string, unknown>;
      };
      const data = payload.data;
      const responder = payload.responder ?? (data && "responder" in data ? data.responder : data);
      if (responder && typeof responder === "object" && "availability" in responder) {
        writeFreshCache(`responder-availability:${userId}`, responder, 5 * 60_000);
      }
    }

    if (notificationsResult.status === "fulfilled" && notificationsResult.value.ok) {
      const payload = await notificationsResult.value.json() as WarmPayload;
      const notifications = payload.data?.notifications ?? payload.data?.items ?? payload.notifications ?? [];
      writeFreshCache(`responder-notifications:${userId}`, Array.isArray(notifications) ? notifications : [], 5 * 60_000);
    }

  } catch {
    // Login must still complete if responder cache warming fails.
  }
}

async function warmDispatcherCache(userId: string, organisationId?: string | null) {
  const scope = organisationId ?? "unassigned";
  const dashboardKey = `dispatcher-dashboard:v3:${userId}:${scope}`;
  const requestsKey = `dispatcher-requests:v3:${userId}:${scope}`;
  const resourcesKey = `dispatcher-resources:v2:${userId}:${scope}`;
  try {
    const [requestsResponse, resourcesResponse] = await Promise.all([
      fetch("/api/requests?scope=all&limit=100", { credentials: "include", cache: "no-store" }),
      fetch("/api/dispatcher/resources", { credentials: "include", cache: "no-store" }),
    ]);
    if (!requestsResponse.ok || !resourcesResponse.ok) return;
    const [requestPayload, resourcesPayload] = await Promise.all([requestsResponse.json(), resourcesResponse.json()]);
    if (requestPayload?.ok === false || resourcesPayload?.ok === false) return;
    const requestRows = requestPayload?.data?.items ?? requestPayload?.items ?? [];
    const resources = resourcesPayload?.data ?? resourcesPayload;
    const profiles = resources?.responders ?? [];
    const busyIds = new Set<string>((resources?.busyResponderIds ?? []).map((id: unknown) => String(id).toLowerCase()));
    const openRequests = requestRows.filter((request: any) => !["closed", "cancelled", "rejected"].includes(String(request.currentStatus ?? request.current_status ?? request.status ?? "").toLowerCase()));
    const requests = requestRows.map((request: any) => {
      const location = request.location ?? request.requestLocation;
      return {
        ...request,
        current_status: request.currentStatus ?? request.current_status ?? request.status,
        is_active: request.isActive ?? request.is_active ?? true,
        location: location ? {
          lat: Number(location.lat ?? location.latitude),
          lng: Number(location.lng ?? location.longitude),
          address: location.address ?? location.addressText ?? "Emergency request location",
          accuracy: location.accuracy ?? location.accuracyMeters,
          capturedAt: location.capturedAt,
        } : undefined,
      };
    });
    const eligibleProfiles = profiles.filter((profile: any) =>
      String(profile.availability).toLowerCase() === "available" && !busyIds.has(String(profile.user_id).toLowerCase()),
    );
    const available = eligibleProfiles.filter((profile: any) => profile.current_latitude != null && profile.current_longitude != null)
      .map((profile: any) => ({
        id: profile.user_id,
        name: profile.user?.display_name || [profile.user?.first_name, profile.user?.last_name].filter(Boolean).join(" ") || "Available responder",
        team: "Response team",
        vehicle: "Ready for assignment",
        availability: "available",
        location: { lat: Number(profile.current_latitude), lng: Number(profile.current_longitude) },
      }));
    const initialCache = {
      requests,
      availableResponders: available,
      availableResponderCount: eligibleProfiles.length,
      operationalRoutes: [],
      mapCenter: resources?.mapCenter ?? null,
    };
    writeFreshCache(resourcesKey, resources, 5 * 60_000);
    writeFreshCache(dashboardKey, initialCache, 5 * 60_000);
    writeFreshCache(requestsKey, requests, 5 * 60_000);

    void Promise.all(openRequests.map(async (request: any) => {
      try {
        const response = await fetch(`/api/Emergency-request/${request.id}/assignments`, { credentials: "include", cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload?.assignment ? { ...payload.assignment, request_id: request.id } : null;
      } catch { return null; }
    })).then((assignmentResults) => {
    const assignments = assignmentResults.filter(Boolean) as any[];
    const byRequest = new Map(assignments.map((assignment) => [assignment.request_id, assignment]));
    const activeAssignments = assignments.filter((assignment) => !["completed", "cancelled", "rejected"].includes(String(assignment.status ?? "").toLowerCase()));
    const usedResponders = new Set<string>();
    const operationalRoutes = openRequests.flatMap((request: any) => {
      const assignment = byRequest.get(request.id);
      const responderId = assignment?.responderUserId ?? assignment?.responder_user_id;
      if (!responderId || usedResponders.has(responderId)) return [];
      const profile = profiles.find((item: any) => item.user_id === responderId);
      const lat = Number(assignment?.responderLatitude ?? assignment?.responder?.current_latitude ?? profile?.current_latitude);
      const lng = Number(assignment?.responderLongitude ?? assignment?.responder?.current_longitude ?? profile?.current_longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      usedResponders.add(responderId);
      const person = profile?.user ?? assignment?.responder?.user;
      return [{ requestId: request.id, responder: { id: responderId, name: assignment?.responderName || person?.display_name || [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Assigned responder", team: "Response team", vehicle: "Response vehicle", location: { lat, lng } } }];
    });
    const latestAssignmentByRequest = new Map(assignments.map((assignment) => [assignment.request_id, assignment]));
    const queueRequests = requests.map((request: any) => {
      const assignment = latestAssignmentByRequest.get(request.id);
      return { ...request, emergency_request_status: request.current_status, assignment_status: assignment?.status ?? null, assignment_id: assignment?.id ?? null, responder_user_id: assignment?.responderUserId ?? assignment?.responder_user_id ?? null, assigned_at: assignment?.assignedAt ?? assignment?.assigned_at ?? null, assigned_by_user_id: assignment?.assignedByUserId ?? assignment?.assigned_by_user_id ?? null };
    });
    const assignedResponderIds = new Set(activeAssignments.map((assignment) => String(assignment.responderUserId ?? assignment.responder_user_id ?? "").toLowerCase()));
    const availableResponders = available.filter((responder: any) => !assignedResponderIds.has(String(responder.id).toLowerCase()));
    writeFreshCache(dashboardKey, { ...initialCache, availableResponders, availableResponderCount: availableResponders.length, operationalRoutes }, 5 * 60_000);
    writeFreshCache(requestsKey, queueRequests, 5 * 60_000);
    });
  } catch {
    // A cache miss is safe; the destination page will fetch its scoped data.
  }
}

async function warmManagerCache(userId: string) {
  try {
    const params = managerAnalyticsParams({
      ...managerDefaultDates(),
      granularity: "day",
      province: "",
      area: "",
      organisationId: "",
    }, "overview");
    const response = await fetch(`/api/manager/analytics?${params.toString()}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.ok === false) return;
    writeFreshCache(managerAnalyticsCacheKey(userId, "overview", params), payload?.data ?? payload, 5 * 60_000);
  } catch {
    // The manager workspace can fetch again if login cache warming fails.
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState(
    "requester@live.co.za"
  );
  const [password, setPassword] = useState(
    "LiveUser123!"
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError("Enter your email address and password to sign in.");
      return;
    }

    setBusy(true);
    setError("");

    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => undefined, 0);
    const timeoutResult = new Promise<Awaited<ReturnType<typeof login>>>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          ok: false,
          message: "Sign in is taking too long. Please try again later.",
        });
      }, 15000);
    });

    const result = await Promise.race([
      login(email, password),
      timeoutResult,
    ]);

    clearTimeout(timeoutId);

    if (!result.ok || !result.user) {
      setBusy(false);
      setError(
        result.message || "Unable to sign in."
      );
      return;
    }

    if (result.user.role === "requester") {
      void primeRequesterMicrophonePermission();
    }

    // The session now lives in httpOnly cookies, so there is nothing to read
    // back from localStorage. Redirect using the user the server just returned.
    //
    // If middleware.ts turned this visit away from a protected page it left
    // ?next= behind, so send them where they were actually going. Only
    // same-origin relative paths are accepted, otherwise ?next= would be an
    // open redirect.
    const requested = new URLSearchParams(
      window.location.search
    ).get("next");

    const safeNext =
      requested &&
      requested.startsWith("/") &&
      !requested.startsWith("//")
        ? requested
        : null;

    if (result.user.role === "requester") {
      // Populate the first screens before navigation so they never render an
      // empty initial state while the cache is being filled.
      await Promise.race([
        warmRequesterCache(result.user.id),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } else if (result.user.role === "responder") {
      await Promise.race([
        warmResponderCache(result.user.id, result.user.organisationId),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } else if (result.user.role === "dispatcher") {
      await Promise.race([
        warmDispatcherCache(result.user.id, result.user.organisationId),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } else if (result.user.role === "manager") {
      await Promise.race([
        warmManagerCache(result.user.id),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }

    router.replace(safeNext ?? roleHome(result.user.role));
  }

  return (
    <div className="min-h-dvh bg-[#f5f7f9]">
      <PublicHeader disabled={busy} />

      <main className="grid min-h-[calc(100dvh-4rem)] place-items-center px-5 pb-8 pt-8 sm:px-6 sm:pt-10">
        <div className="w-full max-w-md">
          <div className="relative top-2 mb-7 text-center">
            <h1 className="text-3xl font-bold tracking-[-0.025em] sm:text-5xl">
              Sign in
            </h1>

            <p className="mt-2 text-sm leading-6 text-[#667b89]">
              Access your secure emergency-response workspace.
            </p>
          </div>

          <form
            onSubmit={submit}
            noValidate
            className="w-full border-b border-[#dce5ea] py-5 sm:py-6"
          >
            <fieldset disabled={busy} className="min-w-0 border-0 p-0">
              <div className="mx-auto mb-5 h-px w-1/2 bg-[#dce5ea] sm:mb-6" aria-hidden="true" />

              <div>
              <FieldLabel>
                Email address
              </FieldLabel>

              <Input
                type="email"
                autoComplete="email"
                placeholder="Type in here"
                className="animated-placeholder"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              </div>

              <div className="mt-4">
              <div className="flex items-center justify-between">
                <FieldLabel>
                  Password
                </FieldLabel>

                <Link
                  href="/forgot-password"
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : undefined}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                  className={`mb-2 text-xs font-semibold transition ${busy ? "pointer-events-none cursor-not-allowed text-[#9aaab3]" : "text-[#0f6872]"}`}
                >
                  Forgot password?
                </Link>
              </div>

              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Type in here"
                className="animated-placeholder"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              </div>

              <Button
              type="submit"
              size="lg"
              className="mt-5 w-full"
              disabled={busy}
              >
              {busy
                ? "Signing in..."
                : "Sign in"}
              </Button>

              <p className="mt-3 text-center text-xs text-[#748693]">
              By signing in, you agree to our{" "}
              <Link
                href="/terms-and-conditions"
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
                className={`font-semibold underline underline-offset-2 ${busy ? "pointer-events-none text-[#9aaab3]" : "text-[#0f6872]"}`}
              >
                Terms and Conditions
              </Link>
              .
              </p>
            </fieldset>

          </form>

          <p className="mt-5 text-center text-sm text-[#687b89]">
            New requester?{" "}
            <Link
              href="/register"
              aria-disabled={busy}
              tabIndex={busy ? -1 : undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
              className={`font-semibold ${busy ? "pointer-events-none text-[#9aaab3]" : "text-[#0f6872]"}`}
            >
              Create an account
            </Link>
          </p>

          <div className="mt-5">
            <DemoAccountPicker
              onPick={(demoEmail, demoPassword) => {
                setEmail(demoEmail);
                setPassword(demoPassword);
              }}
            />
          </div>
        </div>
      </main>

      <TopValidationAlert
        open={Boolean(error)}
        onClose={() => setError("")}
        message={error}
        autoDismissMs={6000}
        topClassName="top-20"
      />
    </div>
  );
}

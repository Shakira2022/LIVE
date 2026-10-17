"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ArrowRight,
  Bell,
  CircleAlert,
  CircleHelp,
  Clock3,
  History,
  MapPin,
  Phone,
  Siren,
  ShieldCheck,
  Ambulance,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { AiAssistantSheet } from "@/components/requester/ai-assistant-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import { requestStatusTone } from "@/lib/utils";
import type { Responder } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* API compatibility types                                                    */
/* -------------------------------------------------------------------------- */

type ApiLocation = {
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;

  accuracyMeters?: number | null;
  accuracy_meters?: number | null;
  accuracy?: number | null;

  addressText?: string | null;
  address_text?: string | null;
  address?: string | null;
  landmark?: string | null;

  locationMethod?: string | null;
  location_method?: string | null;
  method?: string | null;
};

type ApiRequest = {
  id: string;

  reference?: string;
  referenceCode?: string;
  reference_code?: string;

  requesterId?: string;
  requester_id?: string;

  category: string;
  severity: string;

  note?: string | null;

  callbackNumber?: string | null;
  callback_number?: string | null;

  currentStatus?: string;
  current_status?: string;
  status?: string;

  etaMinutes?: number | null;
  eta_minutes?: number | null;

  createdAt?: string;
  created_at?: string;

  updatedAt?: string;
  updated_at?: string;

  assignedResponderId?: string | null;
  assigned_responder_id?: string | null;

  location?: ApiLocation | null;

  request_locations?:
    | ApiLocation[]
    | ApiLocation
    | null;
};

type RequestListResponse = {
  ok?: boolean;

  data?: {
    items?: ApiRequest[];
    requests?: ApiRequest[];
    total?: number;
  };

  items?: ApiRequest[];
  requests?: ApiRequest[];

  message?: string;

  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

type RequestAssignment = {
  id?: string;
  status?: string | null;
  responderUserId?: string | null;
  responder_user_id?: string | null;
  responderName?: string | null;
  responder_name?: string | null;
  responderLatitude?: number | null;
  responderLongitude?: number | null;
  teamName?: string | null;
  team_name?: string | null;
  vehicleCallSign?: string | null;
  vehicle_call_sign?: string | null;
};

type RequestDetailResponse = {
  data?: { assignments?: RequestAssignment[] };
  assignments?: RequestAssignment[];
};

type ApiNotification = {
  id: string;

  readAt?: string | null;
  read_at?: string | null;

  read?: boolean;
};

type RequesterHomeCache = {
  requests: HomeRequest[];
  unread: number;
};

const HOME_CACHE_TTL_MS = 5 * 60_000;

function distanceMetresBetween(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
) {
  const earthRadiusMetres = 6_371_000;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const latitudeDelta = toRadians(secondLatitude - firstLatitude);
  const longitudeDelta = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMetres * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type HelpSection = "help" | "safety";

function HelpAndSafetySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<HelpSection>("help");

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Help & Safety"
      description="Quick guidance for using LIVE safely."
      className="!h-dvh !max-h-dvh rounded-none"
    >
      <nav className="flex border-b border-[#dce5ea] bg-white" aria-label="Help and safety sections">
        {(["help", "safety"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value)}
            className={`flex-1 border-b-2 px-4 py-4 text-sm transition ${section === value ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}
          >
            {value === "help" ? "Help" : "Safety"}
          </button>
        ))}
      </nav>

      {section === "help" ? (
        <div className="divide-y divide-[#dce5ea] px-5 md:px-6">
          <HelpSheetItem icon={<MapPin />} title="Request help">
            Choose the emergency type, confirm your current GPS location, and submit the request.
          </HelpSheetItem>
          <HelpSheetItem icon={<CircleAlert />} title="Track a request">
            When a request is active, the map shows the confirmed location and response progress.
          </HelpSheetItem>
          <HelpSheetItem icon={<Phone />} title="Stay reachable">
            Keep your phone nearby after submitting so responders can contact you if needed.
          </HelpSheetItem>
        </div>
      ) : (
        <div className="divide-y divide-[#dce5ea] px-5 md:px-6">
          <HelpSheetItem icon={<ShieldCheck />} title="Use an accurate location">
            Keep location permission enabled and check that the map reflects where you are before submitting.
          </HelpSheetItem>
          <HelpSheetItem icon={<CircleAlert />} title="Keep the description brief">
            Share the most important facts and do not delay a request to write a long note.
          </HelpSheetItem>
          <HelpSheetItem icon={<Phone />} title="Immediate danger">
            If you cannot use LIVE or are in immediate danger, contact your local emergency service directly.
          </HelpSheetItem>
        </div>
      )}
    </Sheet>
  );
}

function HelpSheetItem({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex items-start gap-4 border-b border-[#dce5ea] py-5 last:border-b-0">
      <span className="mt-0.5 text-[#0f5b67]">{icon}</span>
      <div>
        <h2 className="font-semibold text-[#102b3f]">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[#667b89]">{children}</p>
      </div>
    </article>
  );
}

type NotificationResponse = {
  ok?: boolean;

  data?:
    | ApiNotification[]
    | {
        notifications?: ApiNotification[];
        items?: ApiNotification[];
      };

  notifications?: ApiNotification[];
  items?: ApiNotification[];

  message?: string;

  error?:
    | string
    | {
        code?: string;
        message?: string;
      };
};

/*
 * Shape expected by the existing requester GUI and LiveResponseMap.
 * The GUI below is deliberately left unchanged.
 */
type HomeRequest = {
  id: string;
  referenceCode: string;
  requesterId: string;
  category: string;
  severity: string;
  note: string;
  callbackNumber: string;
  status: string;
  etaMinutes?: number;
  assignedResponderId?: string;
  createdAt: string;
  updatedAt: string;

  location: {
    address: string;
    method: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
  };
};

const ACTIVE_REQUEST_STATUSES = new Set([
  "submitted",
  "received",
  "assigned",
  "acknowledged",
  "en_route",
  "arrived",
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function readJson<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/*
 * The middleware authenticates with httpOnly cookies.
 *
 * If the short-lived access token has expired, refresh it once and retry.
 * This stops the home page from getting stuck because one protected request
 * happened during access-token expiry.
 */
async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response = await fetch(
    input,
    requestInit,
  );

  if (response.status !== 401) {
    return response;
  }

  const refreshResponse = await fetch(
    "/api/auth/refresh",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!refreshResponse.ok) {
    return response;
  }

  response = await fetch(
    input,
    requestInit,
  );

  return response;
}

function extractRequests(
  result: RequestListResponse | null,
): ApiRequest[] {
  if (!result) {
    return [];
  }

  if (
    result.data &&
    Array.isArray(result.data.items)
  ) {
    return result.data.items;
  }

  if (
    result.data &&
    Array.isArray(result.data.requests)
  ) {
    return result.data.requests;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  if (Array.isArray(result.requests)) {
    return result.requests;
  }

  return [];
}

function extractNotifications(
  result: NotificationResponse | null,
): ApiNotification[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result.data)) {
    return result.data;
  }

  if (
    result.data &&
    !Array.isArray(result.data)
  ) {
    if (
      Array.isArray(
        result.data.notifications,
      )
    ) {
      return result.data.notifications;
    }

    if (
      Array.isArray(result.data.items)
    ) {
      return result.data.items;
    }
  }

  if (
    Array.isArray(
      result.notifications,
    )
  ) {
    return result.notifications;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  return [];
}

function getLocation(
  request: ApiRequest,
): ApiLocation | null {
  if (request.location) {
    return request.location;
  }

  if (
    Array.isArray(
      request.request_locations,
    )
  ) {
    return (
      request.request_locations[0] ??
      null
    );
  }

  return (
    request.request_locations ??
    null
  );
}

function normalizeRequest(
  request: ApiRequest,
): HomeRequest {
  const location =
    getLocation(request);

  const status =
    request.currentStatus ??
    request.current_status ??
    request.status ??
    "submitted";

  const createdAt =
    request.createdAt ??
    request.created_at ??
    new Date().toISOString();

  const updatedAt =
    request.updatedAt ??
    request.updated_at ??
    createdAt;

  const latitude =
    location?.latitude ??
    location?.lat ??
    undefined;

  const longitude =
    location?.longitude ??
    location?.lng ??
    undefined;

  return {
    id:
      request.id,

    referenceCode:
      request.reference ??
      request.referenceCode ??
      request.reference_code ??
      request.id,

    requesterId:
      request.requesterId ??
      request.requester_id ??
      "",

    category:
      request.category,

    severity:
      request.severity,

    note:
      request.note?.trim() ||
      "No incident note provided.",

    callbackNumber:
      request.callbackNumber ??
      request.callback_number ??
      "",

    status,

    etaMinutes:
      request.etaMinutes ??
      request.eta_minutes ??
      undefined,

    assignedResponderId:
      request.assignedResponderId ??
      request.assigned_responder_id ??
      undefined,

    createdAt,

    updatedAt,

    location: {
      address:
        location?.addressText ??
        location?.address_text ??
        location?.address ??
        location?.landmark ??
        "Location confirmed",

      method:
        location?.locationMethod ??
        location?.location_method ??
        location?.method ??
        "gps",

      lat:
        typeof latitude === "number"
          ? latitude
          : undefined,

      lng:
        typeof longitude === "number"
          ? longitude
          : undefined,

      accuracy:
        location?.accuracyMeters ??
        location?.accuracy_meters ??
        location?.accuracy ??
        undefined,
    },
  };
}

function readInitialHomeCache(userId: string): RequesterHomeCache | null {
  const cachedHome = readCached<RequesterHomeCache>(`requester-home:${userId}`);
  if (cachedHome) return cachedHome;

  const cachedRequests = readCached<ApiRequest[]>(`requester-history:${userId}`);
  const cachedNotifications = readCached<ApiNotification[]>(`requester-notifications:${userId}`);
  if (!cachedRequests && !cachedNotifications) return null;

  return {
    requests: (cachedRequests ?? []).map(normalizeRequest),
    unread: (cachedNotifications ?? []).filter((notification) => {
      if (typeof notification.read === "boolean") return !notification.read;
      return (notification.readAt ?? notification.read_at ?? null) === null;
    }).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function RequesterHome() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState<
    "Medical" | "Police" | "Firefighting"
  >("Medical");

  const [helpOpen, setHelpOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  function announceUrgentRequest(category: "Medical" | "Police" | "Firefighting") {
    const preferences = readRequesterPreferences();
    if (!preferences.voiceGuidance || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance(
        `${category} emergency request selected. We will confirm your location before sending the request.`,
      ),
    );
  }

  const initialHomeCache = user?.id ? readInitialHomeCache(user.id) : null;
  const hasInitialHomeCache = Boolean(initialHomeCache);

  const [
    requests,
    setRequests,
  ] =
    useState<HomeRequest[]>(() => initialHomeCache?.requests ?? []);

  const [
    unread,
    setUnread,
  ] =
    useState(() => initialHomeCache?.unread ?? 0);

  const [
    dataLoading,
    setDataLoading,
  ] =
    useState(() => !initialHomeCache);

  const initialActiveRequest = initialHomeCache?.requests.find((request) =>
    ACTIVE_REQUEST_STATUSES.has(request.status),
  );
  const initialResponderSnapshot = user?.id && initialActiveRequest
    ? readCached<{ assigned: boolean; name?: string | null; responder: Responder | null }>(`requester-responder:${initialActiveRequest.id}`)
    : null;

  const [activeResponder, setActiveResponder] = useState<Responder | undefined>(
    () => initialResponderSnapshot?.responder ?? undefined,
  );
  const [activeResponderAssigned, setActiveResponderAssigned] = useState(
    () => initialResponderSnapshot?.assigned ?? false,
  );
  const [activeResponderName, setActiveResponderName] = useState<string | undefined>(
    () => initialResponderSnapshot?.name ?? initialResponderSnapshot?.responder?.name ?? undefined,
  );
  const [activeResponderStatus, setActiveResponderStatus] = useState<string | undefined>();

  /*
   * The old page depended on useMockStore():
   *
   *   const { db, loading } = useMockStore();
   *   if (loading || !db || !user) return <PageSkeleton />
   *
   * After the middleware/backend integration, the real source of truth is the
   * authenticated API. If the mock store never becomes ready, that condition
   * leaves this page on the skeleton forever.
   *
   * This page now loads the real authenticated request and notification data.
   */
  const loadHomeData =
    useCallback(async () => {
      if (!user?.id) {
        setRequests([]);
        setUnread(0);
        setDataLoading(false);
        return;
      }

      const cacheKey = `requester-home:${user.id}`;
      const cached = readFreshCache<RequesterHomeCache>(cacheKey);
      if (cached) {
        setRequests(cached.requests);
        setUnread(cached.unread);
        setDataLoading(false);
      }

      if (!hasInitialHomeCache && requests.length === 0) {
        setDataLoading(true);
      }

      try {
        let nextRequests: HomeRequest[] = [];
        let nextUnread = 0;
        /*
         * Requests are the important part of the home page. The middleware
         * already forces a requester to their own rows, so do not send a
         * requesterId/phone from the browser.
         */
        const requestResponse =
          await authenticatedFetch(
            "/api/requests?limit=50&offset=0",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const requestResult =
          await readJson<RequestListResponse>(
            requestResponse,
          );

        if (
          requestResponse.status === 401
        ) {
          await refresh();
          nextRequests = [];
        } else if (
          requestResponse.ok
        ) {
          nextRequests = extractRequests(requestResult).map(normalizeRequest);
        } else {
          /*
           * A request-list failure must not hold the entire landing page on a
           * skeleton forever. Render the normal no-active-request GUI instead.
           */
          console.warn(
            "Requester home request list failed:",
            requestResponse.status,
          );

          nextRequests = [];
        }

        /*
         * Notification count is secondary. Failure here must never prevent
         * the requester home page from opening.
         */
        try {
          const notificationResponse =
            await authenticatedFetch(
              "/api/notifications",
              {
                method: "GET",
                cache: "no-store",
              },
            );

          if (
            notificationResponse.ok
          ) {
            const notificationResult =
              await readJson<NotificationResponse>(
                notificationResponse,
              );

            const notifications =
              extractNotifications(
                notificationResult,
              );

            writeFreshCache(
              `requester-notifications:${user.id}`,
              notifications,
              5 * 60_000,
            );

            const unreadCount =
              notifications.filter(
                (notification) => {
                  if (
                    typeof notification.read ===
                    "boolean"
                  ) {
                    return !notification.read;
                  }

                  return (
                    notification.readAt ??
                    notification.read_at ??
                    null
                  ) === null;
                },
              ).length;

            nextUnread = unreadCount;
          } else {
            nextUnread = 0;
          }
        } catch {
          nextUnread = 0;
        }

        setRequests(nextRequests);
        setUnread(nextUnread);
        const activeRequest = nextRequests.find((request) =>
          ACTIVE_REQUEST_STATUSES.has(request.status),
        );
        writeFreshCache(
          `requester-active-request:${user.id}`,
          { id: activeRequest?.id ?? null },
          activeRequest ? 5 * 60_000 : 30_000,
        );
        writeFreshCache(cacheKey, { requests: nextRequests, unread: nextUnread }, HOME_CACHE_TTL_MS);
      } catch (error) {
        console.warn(
          "Unable to load requester home data:",
          error instanceof Error
            ? error.message
            : String(error),
        );

        /*
         * Most important part of this fix:
         * even an API/network failure leaves the loading state.
         */
      } finally {
        setDataLoading(false);
      }
    }, [
      refresh,
      hasInitialHomeCache,
      requests.length,
      user?.id,
    ]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user?.id) {
      setRequests([]);
      setUnread(0);
      setDataLoading(false);
      return;
    }

    void loadHomeData();

    // Keep the requester view synchronized with responder status changes and
    // assignment updates without requiring a manual page refresh.
    const refreshTimer = window.setInterval(() => {
      void loadHomeData();
    }, 3_000);

    return () => window.clearInterval(refreshTimer);
  }, [
    authLoading,
    user?.id,
    loadHomeData,
  ]);

  const activeRequestForResponder = requests.find((request) =>
    ACTIVE_REQUEST_STATUSES.has(request.status),
  );

  useEffect(() => {
    let cancelled = false;
    const requestId = activeRequestForResponder?.id;
    if (!requestId) {
      setActiveResponder(undefined);
      setActiveResponderAssigned(false);
      setActiveResponderName(undefined);
      setActiveResponderStatus(undefined);
      return;
    }
    const cachedResponder = readCached<{ assigned: boolean; name?: string | null; responder: Responder | null }>(`requester-responder:${requestId}`);
    setActiveResponder(cachedResponder?.responder ?? undefined);
    setActiveResponderAssigned(cachedResponder?.assigned ?? false);
    setActiveResponderName(cachedResponder?.name ?? cachedResponder?.responder?.name ?? undefined);

    const loadResponder = async () => {
      try {
        const response = await authenticatedFetch(`/api/requests/${encodeURIComponent(requestId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = await readJson<RequestDetailResponse>(response);
        const assignments = result?.data?.assignments ?? result?.assignments ?? [];
        const assignment = assignments.at(-1);
        const responderUserId = assignment?.responderUserId ?? assignment?.responder_user_id;
        const responderName = assignment?.responderName ?? assignment?.responder_name ?? undefined;
        setActiveResponderStatus(assignment?.status ?? undefined);
        setActiveResponderAssigned(Boolean(responderUserId));
        setActiveResponderName(responderName);
        if (!responderUserId) {
          writeFreshCache(`requester-responder:${requestId}`, { assigned: false, responder: null }, 5 * 60_000);
        }
        const latitude = Number(assignment?.responderLatitude);
        const longitude = Number(assignment?.responderLongitude);
        if (cancelled || !assignment || !responderUserId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          if (responderUserId) writeFreshCache(`requester-responder:${requestId}`, { assigned: true, name: responderName ?? null, responder: null }, 5 * 60_000);
          return;
        }

        const responderDetails: Responder = {
          id: responderUserId,
          userId: responderUserId,
          name: assignment.responderName ?? assignment.responder_name ?? "Responder",
          team: assignment.teamName ?? assignment.team_name ?? "Response team",
          vehicle: assignment.vehicleCallSign ?? assignment.vehicle_call_sign ?? "Emergency vehicle",
          phone: "",
          organisationId: "",
          availability: "Assigned",
          location: { lat: latitude, lng: longitude },
        };
        setActiveResponder(responderDetails);
        writeFreshCache(`requester-responder:${requestId}`, {
          assigned: true,
          name: responderName ?? null,
          responder: responderDetails,
        }, 5 * 60_000);
      } catch {
        if (!cancelled) {
          setActiveResponder(undefined);
          writeFreshCache(`requester-responder:${requestId}`, { assigned: false, name: null, responder: null }, 5 * 60_000);
        }
      }
    };

    void loadResponder();
    const refreshTimer = window.setInterval(() => {
      void loadResponder();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [activeRequestForResponder?.id]);

  /*
   * Only authentication/data bootstrap may show the skeleton.
   * There is no dependency on mock-store readiness anymore.
   */
  if (
    authLoading ||
    dataLoading
  ) {
    return <PageSkeleton map />;
  }

  /*
   * Protected routing normally redirects an unauthenticated visitor before
   * this point. Keep a skeleton briefly if AuthProvider has no user rather
   * than trying to render user.name.
   */
  if (!user) {
    return <PageSkeleton map />;
  }

  const active = activeRequestForResponder;

  /*
   * The current middleware request-list response does not guarantee that the
   * full responder profile is included. LiveResponseMap accepts an absent
   * responder, and the tracking page remains the authoritative detail view.
   */
  const responder = undefined;

  /*
   * Active request:
   * Mobile uses an app-style, edge-to-edge map.
   * Desktop keeps the two-column workspace.
   */
  if (active) {
    return (
      <div className="flex h-[calc(100dvh-4rem-5rem)] flex-col overflow-hidden bg-transparent pt-0 md:grid md:h-[calc(100dvh-4rem)] md:grid-rows-[auto_minmax(0,1fr)] md:gap-5 md:overflow-hidden md:px-8 md:pt-8">
        <div className="mb-0 px-5 py-3 sm:px-6 md:hidden">
          <PageHeading
            title={`Hello, ${user.name.split(" ")[0]}`}
            description="Your active request is shown below."
            compact
          />
        </div>

        {/* Desktop heading only */}
        <div className="hidden md:block">
          <PageHeading
            title={`Hello, ${
              user.name.split(" ")[0]
            }`}
            description="Your active request is shown below."
            action={
              <Link href="/app/requester/notifications">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Notifications"
                  className="relative"
                >
                  <Bell className="h-5 w-5" />

                  {unread ? (
                    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#d53f3d] px-1 text-[10px] text-white">
                      {unread}
                    </span>
                  ) : null}
                </Button>
              </Link>
            }
          />
        </div>

        {/*
         * Mobile:
         * Fix the map between the top header and
         * bottom navigation. This gives h-full a
         * real height and removes the empty screen.
         *
         * Desktop:
         * Return to normal document positioning.
         */}
        <div
          className="
            relative z-10 min-h-0 flex-1

            md:static md:z-auto md:grid md:h-full md:min-h-0 md:flex-none
            md:grid-cols-[1.35fr_.65fr] md:gap-4
          "
        >
          <div className="h-full min-h-0 overflow-hidden md:min-h-0 md:overflow-hidden">
            <LiveResponseMap
              request={active as any}
              responder={activeResponder ?? responder}
              responderAssigned={activeResponderAssigned}
              responderName={activeResponderName}
              responderStatus={activeResponderStatus}
              responderDistanceMetres={
                activeResponder?.location && active.location.lat != null && active.location.lng != null
                  ? distanceMetresBetween(
                      activeResponder.location.lat,
                      activeResponder.location.lng,
                      active.location.lat,
                      active.location.lng,
                    )
                  : null
              }
              immersive
              compactRequestDetails
              mobileBottomOffset
              className="
                h-full min-h-0 w-full rounded-none

                md:h-full md:min-h-0
                md:rounded-[22px]
              "
              mobileAction={
                <div className="flex gap-2">
                  <Link
                    href={`/app/requester/track/${active.id}`}
                    className="min-w-0 flex-[7]"
                  >
                    <Button className="w-full">
                      Open tracking
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    type="button"
                    onClick={() => setAiOpen(true)}
                    variant="primary"
                    size="icon"
                    className="w-full flex-[3] bg-[#1b8290] hover:bg-[#146c77]"
                    aria-label="Ask LIVE AI"
                    title="Ask LIVE AI"
                  >
                    <Sparkles className="h-5 w-5" />
                  </Button>
                </div>
              }
            />
          </div>

          {/* Desktop request information */}
          <div className="hidden content-start gap-4 md:grid">
            <Panel>
              <PanelHeader
                title="Active request"
                action={
                  <Badge
                    tone={requestStatusTone(
                      active.status as any
                    )}
                  >
                    {active.status}
                  </Badge>
                }
              />

              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  {active.id}
                </p>

                <h2 className="mt-2 text-xl font-semibold">
                  {active.category}
                </h2>

                <p className="mt-2 text-sm leading-6 text-[#5f7482]">
                  {active.note}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#f2f6f8] p-3">
                    <Clock3 className="h-4 w-4 text-[#0f5b67]" />

                    <p className="mt-2 text-xs font-semibold text-[#748693]">
                      Estimated arrival
                    </p>

                    <p className="mt-1 font-semibold">
                      {active.etaMinutes
                        ? `${active.etaMinutes} min`
                        : "Pending"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#f2f6f8] p-3">
                    <MapPin className="h-4 w-4 text-[#0f5b67]" />

                    <p className="mt-2 text-xs font-semibold text-[#748693]">
                      Location
                    </p>

                    <p className="mt-1 truncate font-semibold">
                      {active.location.method}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/app/requester/track/${active.id}`}
                >
                  <Button className="mt-4 w-full">
                    Open tracking
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </Panel>

            <Button
              type="button"
              onClick={() => setAiOpen(true)}
              variant="outline"
              size="lg"
              className="w-full"
            >
              <Sparkles className="h-5 w-5" />
              Ask LIVE AI
            </Button>
          </div>
        </div>

      <AiAssistantSheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        emergency={{
          id: active.id,
          category: active.category,
          severity: active.severity,
          note: active.note,
          status: active.status,
          location: active.location,
        }}
      />
      </div>
    );
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        title={`Hello, ${user.name.split(" ")[0]}`}
        action={
          <span className="block pt-2.5 text-right text-sm leading-6 text-[#667b89]">
            Request help quickly.
          </span>
        }
      />

      {/* Emergency Action Card */}
      <Panel mobileCard={false} className="-mx-5 border-x-0 p-6 md:mx-0 md:border-x bg-white text-slate-900">
        <div className="flex flex-col items-center text-center space-y-5">
          <header className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">Immediate Emergency Assistance</h2>
            <p className="text-xs text-slate-500 max-w-sm">
              Select your emergency type to request priority dispatch.
            </p>
          </header>

          {/* Category Selector Toggles */}
          <div className="grid w-full max-w-md grid-cols-3 gap-2 border-b border-[#dfe7ec]">
            <button
              type="button"
              onClick={() => setSelectedCategory("Medical")}
              className={`flex items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Medical"
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <Ambulance className="h-4 w-4" />
              Medical
            </button>

            <button
              type="button"
              onClick={() => setSelectedCategory("Firefighting")}
              className={`flex items-center justify-center gap-2 border-b-2 px-2 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Firefighting"
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <Siren className="h-4 w-4" />
              Fire
            </button>

            <button
              type="button"
              onClick={() => setSelectedCategory("Police")}
              className={`flex items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Police"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              Police
            </button>
          </div>

          {/* Prolonged Rectangular Emergency Button */}
          <div className="w-full max-w-xs">
            <Link
              href={{
                pathname: "/app/requester/new",
                query: { category: selectedCategory },
              }}
              className="block w-full"
              onClick={() => announceUrgentRequest(selectedCategory)}
            >
              <button
                type="button"
                className="flex w-full items-center justify-center gap-3 bg-[#d53f3d] px-6 py-4 text-base font-bold text-white transition-all hover:bg-[#c23533] active:scale-[0.98]"
              >
                <Siren className="h-6 w-6 animate-pulse" />
                <span>REQUEST {selectedCategory.toUpperCase()} HELP</span>
              </button>
            </Link>
          </div>

          {/* GPS Location Status Indicator */}
          <div className="flex items-center justify-center gap-2 border-t border-[#dfe7ec] px-4 py-2 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5 text-[#0f5b67]" />
            <span>GPS location will be automatically attached</span>
          </div>
        </div>
      </Panel>

      <div className="-mx-5 divide-y divide-[#dfe7ec] bg-transparent md:mx-0 md:grid md:grid-cols-3 md:gap-3 md:divide-y-0 md:border-0 md:bg-transparent">
        <Link
          href="/app/requester/history"
          className="
            flex items-center gap-4 px-5 py-4
            transition active:bg-[#eef4f6]

            md:border-y md:border-[#dfe7ec] md:bg-transparent md:p-4
            md:hover:bg-[#f8fafb]
          "
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f5b67]">
            <History className="h-5 w-5" />
          </span>

          <span>
            <span className="block font-semibold">
              Request history
            </span>

            <span className="mt-1 block text-xs text-[#71828d]">
              {requests.length} stored requests
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="flex items-center gap-4 px-5 py-4 transition active:bg-[#eef4f6] md:p-4 md:hover:bg-[#f8fafb]"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf2f5] text-[#536879]">
            <CircleHelp className="h-5 w-5" />
          </span>

          <span>
            <span className="block font-semibold">Help &amp; Safety</span>
            <span className="mt-1 block text-xs text-[#71828d]">
              Safety and how LIVE works
            </span>
          </span>
        </button>

      </div>

      <HelpAndSafetySheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  MapPin,
  PhoneCall,
  Siren,
  Ambulance,
  ShieldAlert,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useCall, useCallRoom } from "@/components/calls/call-provider";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import { requesterLocale, requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { playNotificationSound } from "@/lib/notification-sound";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { AiAssistantSheet } from "@/components/requester/ai-assistant-sheet";
import { BlindHomeGuidance } from "@/components/requester/blind-home-guidance";
import { CancelRequestButton } from "@/components/requester/cancel-request-button";
import { RequesterPageHelpButton } from "@/components/requester/requester-page-help-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import { TopValidationAlert } from "@/components/ui/top-validation-alert";
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

  cancellationRequestedAt?: string | null;
  cancellation_requested_at?: string | null;

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
  data?: { assignments?: RequestAssignment[]; history?: RequestStatusHistory[] };
  assignments?: RequestAssignment[];
  history?: RequestStatusHistory[];
};

type RequestStatusHistory = {
  id: string;
  newStatus?: string;
  new_status?: string;
  createdAt?: string;
  created_at?: string;
  note?: string | null;
  reason?: string | null;
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
  cancellationRequestedAt?: string | null;
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
      signal: requestInit.signal,
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

async function fetchHomeEndpoint(input: RequestInfo | URL, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await authenticatedFetch(input, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
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

    cancellationRequestedAt:
      request.cancellationRequestedAt ??
      request.cancellation_requested_at ??
      null,

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
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const router = useRouter();
  const { startCall, call } = useCall();

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState<
    "Medical" | "Police" | "Firefighting"
  >("Medical");

  const [aiOpen, setAiOpen] = useState(false);
  const [emergencyTypeChooserOpen, setEmergencyTypeChooserOpen] = useState(false);

  const chooseEmergencyType = useCallback((category: "Medical" | "Police" | "Firefighting") => {
    setSelectedCategory(category);
    setEmergencyTypeChooserOpen(false);
    router.push(`/app/requester/new?category=${encodeURIComponent(category)}&flow=immediate`);
  }, [router]);

  function announceUrgentRequest(category: "Medical" | "Police" | "Firefighting") {
    const preferences = readRequesterPreferences(user?.id);
    if (!preferences.voiceGuidance || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance(
        `${category} emergency request selected. We will confirm your location before sending the request.`,
      ),
    );
  }

  const initialHomeCache = user?.id ? readInitialHomeCache(user.id) : null;

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
  const [activeHistory, setActiveHistory] = useState<RequestStatusHistory[]>([]);
  const [activityIndex, setActivityIndex] = useState(0);
  const activeHistoryLoaded = useRef(false);
  const homeLoadInFlight = useRef(false);

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

      if (homeLoadInFlight.current) return;
      homeLoadInFlight.current = true;

      const cacheKey = `requester-home:${user.id}`;
      const cached = readFreshCache<RequesterHomeCache>(cacheKey);
      if (cached) {
        setRequests(cached.requests);
        setUnread(cached.unread);
        setDataLoading(false);
      }

      try {
        let nextRequests: HomeRequest[] = [];
        let nextUnread = 0;
        /*
         * Requests are the important part of the home page. The middleware
         * already forces a requester to their own rows, so do not send a
         * requesterId/phone from the browser.
         */
        const requestResponse = await fetchHomeEndpoint("/api/requests?limit=50&offset=0");

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
          const notificationResponse = await fetchHomeEndpoint("/api/notifications", 5_000);

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
          { id: activeRequest?.id ?? null, category: activeRequest?.category ?? null },
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
        homeLoadInFlight.current = false;
      }
    }, [
      refresh,
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

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?reason=session_unavailable");
  }, [authLoading, router, user]);

  const activeRequestForResponder = requests.find((request) =>
    ACTIVE_REQUEST_STATUSES.has(request.status),
  );
  useCallRoom(activeRequestForResponder?.id);

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      const detail = (event as CustomEvent<{ action?: string; category?: string }>).detail;
      if (action === "open-emergency-type-chooser") {
        if (activeRequestForResponder?.id) router.push(`/app/requester/track/${activeRequestForResponder.id}`);
        else setEmergencyTypeChooserOpen(true);
      }
      if (action === "request-emergency-immediate" && detail?.category) {
        if (activeRequestForResponder?.id) router.push(`/app/requester/track/${activeRequestForResponder.id}`);
        else if (detail.category === "Medical" || detail.category === "Police" || detail.category === "Firefighting") {
          chooseEmergencyType(detail.category);
        }
      }
      if (action === "open-ai") setAiOpen(true);
      if (action === "close-ai") setAiOpen(false);
      if (action === "open-tracking" && activeRequestForResponder?.id) {
        router.push(`/app/requester/track/${activeRequestForResponder.id}`);
      }
      if (action === "call-driver" && activeRequestForResponder?.id && activeResponder?.userId && activeResponderName) {
        void startCall(activeRequestForResponder.id, activeResponderName, { targetRole: "responder", targetUserId: activeResponder.userId });
      }
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, [activeRequestForResponder?.id, activeResponder?.userId, activeResponderName, call.isCaller, call.roomId, call.targetUserId, chooseEmergencyType, router, startCall]);

  useEffect(() => {
    if (!emergencyTypeChooserOpen) return;
    const handleVoiceChoice = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      const spoken = (detail.transcript ?? "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const category = /\b(?:fire|firefighting|fire fighter|fire department|smoke|burning|flames)\b/.test(spoken)
        ? "Firefighting"
        : /\b(?:police|law enforcement|police department|personal safety|unsafe|being followed)\b/.test(spoken)
          ? "Police"
          : /\b(?:medical|medicine|ambulance|doctor|health|injured|injury|not breathing|unconscious)\b/.test(spoken)
            ? "Medical"
            : null;
      if (!category) return;
      detail.consumed = true;
      if (detail.isFinal) chooseEmergencyType(category);
    };
    window.addEventListener("live:requester-voice-input", handleVoiceChoice);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceChoice);
  }, [emergencyTypeChooserOpen, chooseEmergencyType]);

  const lastObservedRequestStatus = useRef<{ id: string; status: string } | null>(null);
  const [responderArrivedNoticeOpen, setResponderArrivedNoticeOpen] = useState(false);
  useEffect(() => {
    if (!activeRequestForResponder) {
      lastObservedRequestStatus.current = null;
      return;
    }

    const currentStatus = activeRequestForResponder.status.toLowerCase().replace(/[\s-]+/g, "_");
    const previous = lastObservedRequestStatus.current;
    if (previous?.id === activeRequestForResponder.id && previous.status !== "arrived" && currentStatus === "arrived" && user?.id) {
      playNotificationSound(user.id, 3);
      setResponderArrivedNoticeOpen(true);
    }
    if (user?.id && readRequesterPreferences(user.id).voiceGuidance && (currentStatus === "assigned" || currentStatus === "en_route" || currentStatus === "arrived" || currentStatus === "closed")) {
      const isFirstObservation = previous?.id !== activeRequestForResponder.id;
      const statusChanged = previous?.id === activeRequestForResponder.id && previous.status !== currentStatus;
      if (isFirstObservation || statusChanged) {
        const message = currentStatus === "assigned"
          ? "A responder has been assigned to your request. They may not have started travelling yet."
          : currentStatus === "en_route"
            ? "Your responder is on the way. Keep your phone available."
            : currentStatus === "arrived"
              ? "Your responder has arrived. Follow their instructions."
              : "Your emergency request has been closed.";
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(requesterText(uiLanguage, message));
          utterance.lang = ({ English: "en-ZA", Afrikaans: "af-ZA", isiZulu: "zu-ZA", isiXhosa: "xh-ZA", Sesotho: "st-ZA", Setswana: "tn-ZA", Sepedi: "nso-ZA", siSwati: "ss-ZA", Tshivenda: "ve-ZA", isiNdebele: "nr-ZA", XiTsonga: "ts-ZA" } as const)[uiLanguage];
          utterance.rate = 0.94;
          window.speechSynthesis.speak(utterance);
        }
      }
    }
    lastObservedRequestStatus.current = { id: activeRequestForResponder.id, status: currentStatus };
  }, [activeRequestForResponder?.id, activeRequestForResponder?.status, uiLanguage, user?.id]);

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
    setActiveHistory([]);
    setActivityIndex(0);
    activeHistoryLoaded.current = false;

    const loadResponder = async () => {
      try {
        const response = await authenticatedFetch(`/api/requests/${encodeURIComponent(requestId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = await readJson<RequestDetailResponse>(response);
        const history = result?.data?.history ?? result?.history ?? [];
        if (!cancelled) {
          setActiveHistory(history);
          if (!activeHistoryLoaded.current && history.length > 0) {
            setActivityIndex(history.length - 1);
            activeHistoryLoaded.current = true;
          }
        }
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

  /* Redirect after failed auth instead of leaving a permanent skeleton. */
  if (!user) {
    return null;
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
      <div className="flex h-[calc(100dvh-4rem-5rem)] flex-col overflow-hidden bg-transparent pt-0 md:grid md:h-auto md:min-h-[calc(100dvh-4rem)] md:grid-rows-[auto_auto] md:gap-5 md:overflow-visible md:px-8 md:pt-8 md:pb-8">
        <BlindHomeGuidance
          userId={user.id}
          language={uiLanguage}
          loading={false}
          emergency={{
            id: active.id,
            category: active.category,
            note: active.note,
            address: active.location.address,
            status: active.status,
            driverAssigned: activeResponderAssigned,
            driverName: activeResponderName,
            driverStatus: activeResponderStatus,
            etaMinutes: active.etaMinutes,
          }}
        />
        <div className="mb-0 px-5 py-3 sm:px-6 md:hidden">
          <PageHeading
            title={requesterText(uiLanguage, "Hello, {name}", { name: user.name })}
            description={requesterText(uiLanguage, "Your active request is shown below.")}
            compact
            action={<RequesterPageHelpButton page="home" language={uiLanguage} />}
          />
        </div>

        {/* Desktop heading only */}
        <div className="hidden md:block">
          <PageHeading
            title={requesterText(uiLanguage, "Hello, {name}", { name: user.name })}
            description={requesterText(uiLanguage, "Your active request is shown below.")}
            action={
              <div className="flex items-center gap-2">
                <Link href="/app/requester/notifications">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={requesterText(uiLanguage, "Notifications")}
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
                <RequesterPageHelpButton page="home" language={uiLanguage} />
              </div>
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

            md:static md:z-auto md:grid md:h-auto md:min-h-[min(72dvh,800px)] md:flex-none
            md:grid-cols-[1.35fr_.65fr] md:gap-4
          "
        >
          <div className="h-full min-h-0 overflow-hidden md:min-h-0 md:overflow-hidden">
            <LiveResponseMap
              request={active as any}
              uiLanguage={uiLanguage}
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

                md:h-[min(72dvh,800px)] md:min-h-[500px] md:self-start
                md:rounded-[22px]
              "
              mobileAction={
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/app/requester/track/${active.id}`} className="min-w-0">
                    <Button data-live-voice-number="1" className="w-full px-2 text-xs sm:text-sm">
                      {requesterText(uiLanguage, "Open tracking")}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    data-live-voice-number="2"
                    type="button"
                    variant="outline"
                    disabled={!activeResponderAssigned || !activeResponder?.userId || call.status !== "idle"}
                    onClick={() => {
                      if (!activeResponder?.userId) return;
                      void startCall(`responder:${activeResponder.userId}`, activeResponderName || activeResponder.name || "Responder", {
                        targetRole: "responder",
                        targetUserId: activeResponder.userId,
                        requestId: active.id,
                      });
                    }}
                    className="w-full min-w-0 px-2 text-xs sm:text-sm"
                    aria-label={requesterText(uiLanguage, "Call assigned responder")}
                    title={requesterText(uiLanguage, "Call assigned responder")}
                  >
                    <PhoneCall className="h-4 w-4 shrink-0" />
                    <span className="truncate">{requesterText(uiLanguage, "Call responder")}</span>
                  </Button>
                  <CancelRequestButton
                    key={active.id}
                    requestId={active.id}
                    status={active.status}
                    language={uiLanguage}
                    requestedAlready={Boolean(active.cancellationRequestedAt)}
                    voiceButtonNumber={3}
                    onRequested={() => void loadHomeData()}
                    className="col-span-2 min-w-0"
                  />
                </div>
              }
            />
          </div>

          {/* Desktop request information */}
          <div className="hidden content-start gap-4 md:grid">
            <Panel>
              <PanelHeader
                title={requesterText(uiLanguage, "Active request")}
                action={
                  <Badge
                    tone={requestStatusTone(
                      active.status as any
                    )}
                  >
                    {requesterText(uiLanguage, active.status)}
                  </Badge>
                }
              />

              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  {active.id}
                </p>

                <h2 className="mt-2 text-xl font-semibold">
                  {requesterText(uiLanguage, active.category)}
                </h2>

                <p className="mt-2 text-sm leading-6 text-[#5f7482]">
                  {active.note}
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <div className="rounded-xl bg-[#f2f6f8] p-3">
                    <Clock3 className="h-4 w-4 text-[#0f5b67]" />

                    <p className="mt-2 text-xs font-semibold text-[#748693]">
                      {requesterText(uiLanguage, "Estimated arrival")}
                    </p>

                    <p className="mt-1 font-semibold">
                      {active.etaMinutes
                        ? `${active.etaMinutes} min`
                        : requesterText(uiLanguage, "Pending")}
                    </p>
                  </div>

                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link href={`/app/requester/track/${active.id}`} className="min-w-0">
                    <Button data-live-voice-number="1" className="w-full min-w-0 px-2 text-xs sm:text-sm">
                      {requesterText(uiLanguage, "Open tracking")}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    data-live-voice-number="2"
                    type="button"
                    variant="outline"
                    disabled={!activeResponderAssigned || !activeResponder?.userId || call.status !== "idle"}
                    onClick={() => {
                      if (!activeResponder?.userId) return;
                      void startCall(`responder:${activeResponder.userId}`, activeResponderName || activeResponder.name || "Responder", {
                        targetRole: "responder",
                        targetUserId: activeResponder.userId,
                        requestId: active.id,
                      });
                    }}
                    className="w-full min-w-0 px-2 text-xs sm:text-sm"
                  >
                    <PhoneCall className="h-4 w-4 shrink-0" />
                    <span className="truncate">{requesterText(uiLanguage, "Call responder")}</span>
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <CancelRequestButton
                    key={active.id}
                    requestId={active.id}
                    status={active.status}
                    language={uiLanguage}
                    requestedAlready={Boolean(active.cancellationRequestedAt)}
                    voiceButtonNumber={3}
                    onRequested={() => void loadHomeData()}
                    className="col-span-2 min-w-0"
                  />
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={requesterText(uiLanguage, "Activity")} description={requesterText(uiLanguage, "Latest request status update.")} />
              <div className="flex items-center gap-3 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-[#0f5b67]"><Activity className="h-4 w-4" /></span>
                <div key={`${active.id}-${activityIndex}`} className="activity-status-transition min-w-0 flex-1">
                  <p className="font-semibold capitalize text-[#102b3f]">{requesterText(uiLanguage, (activeHistory[activityIndex]?.newStatus ?? activeHistory[activityIndex]?.new_status ?? active.status).replace(/_/g, " "))}</p>
                  <p className="mt-1 text-xs text-[#84949d]">{(() => { const timestamp = activeHistory[activityIndex]?.createdAt ?? activeHistory[activityIndex]?.created_at ?? active.updatedAt; return timestamp ? new Intl.DateTimeFormat(requesterLocale(uiLanguage), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)) : requesterText(uiLanguage, "Latest status"); })()}</p>
                  {activeHistory[activityIndex]?.note || activeHistory[activityIndex]?.reason ? <p className="mt-1 text-sm leading-5 text-[#5f7482]">{requesterText(uiLanguage, activeHistory[activityIndex].note ?? activeHistory[activityIndex].reason ?? "")}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={requesterText(uiLanguage, "View earlier activity")} disabled={activityIndex <= 0} onClick={() => setActivityIndex((index) => Math.max(0, index - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce5ea] text-[#0f5b67] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label={requesterText(uiLanguage, "View newer activity")} disabled={activityIndex >= activeHistory.length - 1} onClick={() => setActivityIndex((index) => Math.min(activeHistory.length - 1, index + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce5ea] text-[#0f5b67] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </Panel>
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
          responder: activeResponder?.userId && activeResponderName
            ? { id: activeResponder.userId, name: activeResponderName }
            : null,
        }}
      />
      </div>
    );
  }

  return (
    <div className="app-page grid gap-5">
      <TopValidationAlert
        open={responderArrivedNoticeOpen}
        onClose={() => setResponderArrivedNoticeOpen(false)}
        message={requesterText(uiLanguage, "Your responder has arrived at the scene.")}
        autoDismissMs={12_000}
        topClassName="top-20"
      />
      <BlindHomeGuidance userId={user.id} language={uiLanguage} loading={false} emergency={null} />
      <PageHeading
        title={requesterText(uiLanguage, "Hello, {name}", { name: user.name })}
        description={requesterText(uiLanguage, "Request help quickly.")}
        action={<RequesterPageHelpButton page="home" language={uiLanguage} />}
      />

      {/* Emergency Action Card */}
      <Panel mobileCard={false} className="-mx-5 border-x-0 p-6 md:mx-0 md:border-x bg-white text-slate-900">
        <div className="flex flex-col items-center text-center space-y-5">
          <header className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">{requesterText(uiLanguage, "Immediate Emergency Assistance")}</h2>
            <p className="text-xs text-slate-500 max-w-sm">
              {requesterText(uiLanguage, "Select your emergency type to request priority dispatch.")}
            </p>
          </header>

          {/* Category Selector Toggles */}
          <div className="grid w-full max-w-md grid-cols-3 gap-2 border-b border-[#dfe7ec]">
            <button
              data-live-voice-number="1"
              type="button"
              onClick={() => setSelectedCategory("Medical")}
              className={`flex items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Medical"
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <Ambulance className="h-4 w-4" />
              {requesterText(uiLanguage, "Medical")}
            </button>

            <button
              data-live-voice-number="2"
              type="button"
              onClick={() => setSelectedCategory("Firefighting")}
              className={`flex items-center justify-center gap-2 border-b-2 px-2 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Firefighting"
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <Siren className="h-4 w-4" />
              {requesterText(uiLanguage, "Fire")}
            </button>

            <button
              data-live-voice-number="3"
              type="button"
              onClick={() => setSelectedCategory("Police")}
              className={`flex items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
                selectedCategory === "Police"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-600 hover:border-slate-300"
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              {requesterText(uiLanguage, "Police")}
            </button>
          </div>

          {/* Prolonged Rectangular Emergency Button */}
          <div className="w-full max-w-xs">
            <Link
              href={{
                pathname: "/app/requester/new",
                query: { category: selectedCategory, flow: "immediate" },
              }}
              className="block w-full"
              onClick={() => announceUrgentRequest(selectedCategory)}
            >
              <button
                data-live-voice-number="4"
                type="button"
                className="flex w-full items-center justify-center gap-3 bg-[#d53f3d] px-6 py-4 text-base font-bold text-white transition-all hover:bg-[#c23533] active:scale-[0.98]"
              >
                <Siren className="h-6 w-6 animate-pulse" />
                <span>{requesterText(uiLanguage, `REQUEST ${selectedCategory.toUpperCase()} HELP`)}</span>
              </button>
            </Link>
          </div>

          {/* GPS Location Status Indicator */}
          <div className="flex items-center justify-center gap-2 border-t border-[#dfe7ec] px-4 py-2 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5 text-[#0f5b67]" />
            <span>{requesterText(uiLanguage, "GPS location will be automatically attached")}</span>
          </div>
        </div>
      </Panel>

      <div className="-mx-5 divide-y divide-[#dfe7ec] bg-transparent md:mx-0 md:grid md:grid-cols-1 md:gap-3 md:divide-y-0 md:border-0 md:bg-transparent">
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
              {requesterText(uiLanguage, "Request history")}
            </span>

            <span className="mt-1 block text-xs text-[#71828d]">
              {requesterText(uiLanguage, "{count} stored requests", { count: requests.length })}
            </span>
          </span>
        </Link>
      </div>

      <Sheet
        open={emergencyTypeChooserOpen}
        onOpenChange={setEmergencyTypeChooserOpen}
        title={requesterText(uiLanguage, "Choose emergency help")}
        description={requesterText(uiLanguage, "Choose Medical, Fire, or Police. We will confirm your location before sending the request.")}
        side="center"
      >
        <div className="grid gap-3 px-5 py-4 sm:px-6">
          {([
            { label: "Medical", category: "Medical" as const },
            { label: "Fire", category: "Firefighting" as const },
            { label: "Police", category: "Police" as const },
          ]).map((option, index) => (
            <Button
              key={option.category}
              data-live-voice-option
              type="button"
              variant="outline"
              className="min-h-14 justify-start gap-3 text-left"
              onClick={() => chooseEmergencyType(option.category)}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-xs font-bold text-[#0f6872]">{index + 1}</span>
              <span>{requesterText(uiLanguage, option.label)}</span>
            </Button>
          ))}
          <p className="text-center text-xs text-[#71838f]">{requesterText(uiLanguage, "With voice commands on, say Medical, Fire, or Police, or say an option number and select.")}</p>
        </div>
      </Sheet>
      <AiAssistantSheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        emergency={{
          id: "",
          category: "General assistance",
          severity: "High",
          note: "",
          status: "",
          location: { address: "Location unavailable" },
        }}
      />
    </div>
  );
}

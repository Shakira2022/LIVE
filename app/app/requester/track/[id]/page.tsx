"use client";

import Link from "next/link";
import {
  ArrowLeft,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  History,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useParams,
  useRouter,
} from "next/navigation";

import {
  useAuth,
} from "@/components/auth/auth-provider";
import { useCall, useCallRoom } from "@/components/calls/call-provider";
import {
  LiveResponseMap,
} from "@/components/maps/live-response-map";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  PageHeading,
} from "@/components/ui/page-heading";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import {
  PageSkeleton,
} from "@/components/ui/skeleton";
import {
  requestStatusTone,
} from "@/lib/utils";
import { clearClientCache, readCached } from "@/lib/client-cache";
import type { RequesterLanguage } from "@/lib/requester-language";
import { requesterLocale, requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { useBlindVoiceAnnouncement } from "@/components/requester/use-blind-voice-announcement";
import { CancelRequestButton } from "@/components/requester/cancel-request-button";
import type { Responder } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* API types                                                                  */
/* -------------------------------------------------------------------------- */

type EmergencyStatus =
  | "submitted"
  | "received"
  | "assigned"
  | "acknowledged"
  | "en_route"
  | "arrived"
  | "completed"
  | "closed"
  | "cancelled"
  | "rejected";

function isTerminalRequestStatus(status?: string | null) {
  return ["completed", "closed", "cancelled", "rejected"].includes(String(status ?? "").toLowerCase());
}

type ApiLocation = {
  latitude?: number | null;
  longitude?: number | null;

  accuracyMeters?: number | null;
  accuracy_meters?: number | null;

  addressText?: string | null;
  address_text?: string | null;

  landmark?: string | null;

  locationMethod?: string | null;
  location_method?: string | null;

  capturedAt?: string | null;
  captured_at?: string | null;
};

type StatusHistoryItem = {
  id?: string;

  previousStatus?: string | null;
  previous_status?: string | null;

  newStatus?: string;
  new_status?: string;

  note?: string | null;
  reason?: string | null;

  createdAt?: string;
  created_at?: string;
};

type ApiAssignment = {
  id?: string;
  status?: string | null;
  responderUserId?: string | null;
  responder_user_id?: string | null;
  responderName?: string | null;
  responder_name?: string | null;
  responderLatitude?: number | null;
  responder_latitude?: number | null;
  responderLongitude?: number | null;
  responder_longitude?: number | null;
  teamName?: string | null;
  team_name?: string | null;
  vehicleCallSign?: string | null;
  vehicle_call_sign?: string | null;
};

type ApiRequest = {
  id: string;

  /* Middleware/canonical fields */
  reference?: string;
  requesterId?: string;
  currentStatus?: EmergencyStatus;
  cancellationRequestedAt?: string | null;
  cancellation_requested_at?: string | null;
  callbackNumber?: string | null;
  etaMinutes?: number | null;
  assignedResponderId?: string | null;
  assigned_responder_id?: string | null;
  createdAt?: string;
  updatedAt?: string;
  location?: ApiLocation | null;
  statusHistory?: StatusHistoryItem[];
  history?: StatusHistoryItem[];
  assignments?: ApiAssignment[];

  /* Old backend fields kept as compatibility fallbacks */
  reference_code?: string;
  requester_id?: string;
  current_status?: EmergencyStatus;
  callback_number?: string | null;
  eta_minutes?: number | null;
  created_at?: string;
  updated_at?: string;

  request_locations?:
    | ApiLocation[]
    | ApiLocation
    | null;

  request_status_history?:
    | StatusHistoryItem[]
    | null;

  category: string;
  severity: string;
  note?: string | null;
};

type DetailResponse = {
  ok?: boolean;

  data?: ApiRequest;

  /* Older backend response */
  request?: ApiRequest;

  message?: string;

  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<
          string,
          string[]
        >;
      };

  requestId?: string;
};

/* -------------------------------------------------------------------------- */
/* Normalized UI request                                                      */
/* -------------------------------------------------------------------------- */

type UiRequest = {
  id: string;
  referenceCode: string;
  requesterId: string;
  category: string;
  severity: string;
  note: string;
  callbackNumber: string;
  status: EmergencyStatus;
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

  history: Array<{
    id: string;
    status: string;
    note: string;
    createdAt: string;
  }>;
};

type ResponderSnapshot = {
  assigned: boolean;
  name?: string | null;
  responder: Responder | null;
};

function assignmentToResponder(assignments?: ApiAssignment[]): Responder | undefined {
  const assignment = assignments?.at(-1);
  const responderUserId = assignment?.responderUserId ?? assignment?.responder_user_id;
  const latitude = Number(assignment?.responderLatitude ?? assignment?.responder_latitude);
  const longitude = Number(assignment?.responderLongitude ?? assignment?.responder_longitude);
  if (!assignment || !responderUserId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

  return {
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
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getErrorMessage(
  payload: DetailResponse | null,
  fallback: string,
) {
  if (!payload) {
    return fallback;
  }

  if (
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error === "object"
  ) {
    const firstDetail =
      payload.error.details
        ? Object.values(
            payload.error.details,
          )
            .flat()
            .find(Boolean)
        : undefined;

    return (
      firstDetail ||
      payload.error.message ||
      payload.message ||
      fallback
    );
  }

  return (
    payload.message ||
    fallback
  );
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response = await fetch(input, requestInit);

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

  response = await fetch(input, requestInit);
  return response;
}

function getLocation(
  request: ApiRequest,
): ApiLocation | null {
  if (request.location) {
    return request.location;
  }

  const locations =
    request.request_locations;

  if (!locations) {
    return null;
  }

  if (Array.isArray(locations)) {
    return locations[0] ?? null;
  }

  return locations;
}

function normalizeRequest(
  request: ApiRequest,
): UiRequest {
  const location =
    getLocation(request);

  const createdAt =
    request.createdAt ??
    request.created_at ??
    new Date().toISOString();

  const updatedAt =
    request.updatedAt ??
    request.updated_at ??
    createdAt;

  const status =
    request.currentStatus ??
    request.current_status ??
    "submitted";

  const rawHistory =
    request.statusHistory ??
    request.history ??
    request.request_status_history ??
    [];

  return {
    id:
      request.id,

    referenceCode:
      request.reference ??
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
      request.assignments?.at(-1)?.responderUserId ??
      request.assignments?.at(-1)?.responder_user_id ??
      undefined,

    createdAt,

    updatedAt,

    location: {
      address:
        location?.addressText ??
        location?.address_text ??
        location?.landmark ??
        "Emergency request location",

      method:
        location?.locationMethod ??
        location?.location_method ??
        "gps",

      lat:
        typeof location?.latitude ===
        "number"
          ? location.latitude
          : undefined,

      lng:
        typeof location?.longitude ===
        "number"
          ? location.longitude
          : undefined,

      accuracy:
        location?.accuracyMeters ??
        location?.accuracy_meters ??
        undefined,
    },

    history:
      Array.isArray(rawHistory)
        ? rawHistory
            .map(
              (
                item,
                index,
              ) => ({
                id:
                  item.id ??
                  `${request.id}-${index}`,

                status:
                  item.newStatus ??
                  item.new_status ??
                  status,

                note:
                  item.note ??
                  item.reason ??
                  "",

                createdAt:
                  item.createdAt ??
                  item.created_at ??
                  updatedAt,
              }),
            )
            .sort(
              (a, b) =>
                new Date(
                  b.createdAt,
                ).getTime() -
                new Date(
                  a.createdAt,
                ).getTime(),
            )
        : [],
  };
}

function formatDateTime(
  value: string,
  language: RequesterLanguage,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unknown time";
  }

  return date.toLocaleString(
    requesterLocale(language),
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

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

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function RequestTrackingPage() {
  const params =
    useParams<{
      id: string;
    }>();

  const router =
    useRouter();

  const {
    user,
    loading: authLoading,
  } = useAuth();
  const { call, startCall } = useCall();
  const isResponder = user?.role === "responder";
  const isRequester = user?.role === "requester";
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  const id =
    typeof params?.id === "string"
      ? params.id
      : "";
  useCallRoom(id);

  const cachedRequests = user?.id
    ? readCached<ApiRequest[]>(
        `requester-history:${user.id}`,
      )
    : null;

  const cachedRequest = cachedRequests?.find(
    (cached) => cached.id === id,
  );
  // Requesters must load the current status before showing a responder marker;
  // cached history may still describe a mission that has since ended.
  const initialCachedRequest = user?.role === "requester" ? null : cachedRequest;
  const cachedResponder = user?.id && user.role !== "requester"
    ? readCached<ResponderSnapshot>(`requester-responder:${id}`)
    : null;

  const [
    request,
    setRequest,
  ] =
    useState<UiRequest | null>(
      () =>
        initialCachedRequest
          ? normalizeRequest(initialCachedRequest)
          : null,
    );

  const [activityIndex, setActivityIndex] = useState(0);

  const [
    loading,
    setLoading,
  ] =
    useState(() => !initialCachedRequest);

  const [
    notFound,
    setNotFound,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [activeResponder, setActiveResponder] = useState<Responder | undefined>(
    () => cachedResponder?.responder ?? undefined,
  );
  const [activeResponderName, setActiveResponderName] = useState<string | undefined>(
    () => cachedResponder?.name ?? cachedResponder?.responder?.name ?? undefined,
  );
  const [responderAssigned, setResponderAssigned] = useState(
    () => cachedResponder?.assigned ?? false,
  );
  const [activeResponderStatus, setActiveResponderStatus] = useState<string | undefined>();
  const requestIsTerminal = isTerminalRequestStatus(request?.status);
  const canCallRequester = user?.role === "responder" &&
    Boolean(request?.assignedResponderId === user.id) &&
    Boolean(request?.requesterId) &&
    ["assigned", "acknowledged", "en_route", "arrived"].includes(String(request?.status).toLowerCase());
  const trackedRequestLocation = request?.location;
  const trackingDistanceMetres = !requestIsTerminal && activeResponder?.location && trackedRequestLocation?.lat != null && trackedRequestLocation.lng != null
    ? distanceMetresBetween(
        activeResponder.location.lat,
        activeResponder.location.lng,
        trackedRequestLocation.lat,
        trackedRequestLocation.lng,
      )
    : null;
  const responderHasArrived = activeResponderStatus === "arrived" || request?.status === "arrived";
  const responderIsNear = !responderHasArrived && trackingDistanceMetres != null && trackingDistanceMetres <= 1_000;
  const mobileTrackingStatus = !request
    ? requesterText(uiLanguage, "Loading request")
    : responderHasArrived
      ? requesterText(uiLanguage, "You have arrived")
      : responderIsNear
        ? requesterText(uiLanguage, "You are arriving soon")
        : requesterText(uiLanguage, request.status.replace(/_/g, " "));
  const trackingAnnouncement = loading
    ? null
    : notFound
      ? requesterText(uiLanguage, "I could not find this emergency request.")
      : request
        ? [
            requesterText(uiLanguage, "Request {reference} status: {status}.", {
              reference: request.referenceCode,
              status: requesterText(uiLanguage, request.status.replace(/_/g, " ")),
            }),
            responderAssigned
              ? activeResponderStatus?.toLowerCase() === "arrived" || request.status === "arrived"
                ? requesterText(uiLanguage, "Responder {name} has arrived.", { name: activeResponderName || requesterText(uiLanguage, "assigned responder") })
                : activeResponderStatus?.toLowerCase() === "en_route" || request.status === "en_route"
                  ? requesterText(uiLanguage, "Responder {name} is on the way. Estimated arrival: {eta}.", {
                      name: activeResponderName || requesterText(uiLanguage, "assigned responder"),
                      eta: request.etaMinutes != null ? `${request.etaMinutes} ${requesterText(uiLanguage, "minutes")}` : requesterText(uiLanguage, "not available"),
                    })
                  : requesterText(uiLanguage, "Responder {name} has been assigned.", { name: activeResponderName || requesterText(uiLanguage, "assigned responder") })
              : requesterText(uiLanguage, "Dispatch is reviewing your request. No responder has been assigned yet."),
          ].join(" ")
        : null;
  useBlindVoiceAnnouncement(trackingAnnouncement, uiLanguage, isRequester, user?.id);

  function callRequester() {
    const requesterId = request?.requesterId;
    if (!canCallRequester || call.status !== "idle" || !requesterId) return;
    void startCall(id, "Requester", { targetRole: "requester", targetUserId: requesterId, requestId: id });
  }

  /* ---------------------------------------------------------------------- */
  /* Load request                                                           */
  /* ---------------------------------------------------------------------- */

  const loadRequest =
    useCallback(
      async (
        silent = false,
      ) => {
        /*
         * Do not decide "not found" while auth is still restoring the
         * httpOnly-cookie session. That was one cause of the false screen.
         */
        if (
          authLoading ||
          !user ||
          !id
        ) {
          return;
        }

        if (!silent) {
          setLoading(true);
        }

        setError("");
        setNotFound(false);

        try {
          const response =
            await authenticatedFetch(
              `/api/requests/${encodeURIComponent(
                id,
              )}`,
              {
                method:
                  "GET",

                credentials:
                  "include",

                cache:
                  "no-store",
              },
            );

          let payload:
            | DetailResponse
            | null = null;

          try {
            payload =
              (await response.json()) as
                DetailResponse;
          } catch {
            payload = null;
          }

          console.log(
            "TRACK REQUEST STATUS:",
            response.status,
          );

          console.log(
            "TRACK REQUEST RESPONSE:",
            payload,
          );

          /*
           * Only show the "not found" screen when the SERVER truly returned
           * 404. A successful 200 with a different response envelope must not
           * be interpreted as a missing request.
           */
          if (
            response.status ===
            404
          ) {
            setRequest(null);
            setNotFound(true);

            setError(
              getErrorMessage(
                payload,
                "Emergency request not found.",
              ),
            );

            return;
          }

          if (!response.ok) {
            throw new Error(
              getErrorMessage(
                payload,
                `Unable to load this emergency request. Server returned ${response.status}.`,
              ),
            );
          }

          /*
           * CURRENT middleware response:
           *
           * {
           *   ok: true,
           *   data: { ...request },
           *   requestId: "..."
           * }
           *
           * OLD backend response:
           *
           * {
           *   request: { ...request }
           * }
           *
           * Support both while the project is being migrated.
           */
          const apiRequest =
            payload?.data ??
            payload?.request ??
            null;

          if (!apiRequest) {
            throw new Error(
              "The server returned a successful response but did not include the emergency request.",
            );
          }

          const nextRequest = normalizeRequest(apiRequest);
          setRequest(nextRequest);
          if (isTerminalRequestStatus(nextRequest.status)) {
            setActiveResponder(undefined);
            setActiveResponderName(undefined);
            setActiveResponderStatus(undefined);
            setResponderAssigned(false);
            clearClientCache(`requester-responder:${id}`);
          } else {
            const nextResponder = assignmentToResponder(apiRequest.assignments);
            const latestAssignment = apiRequest.assignments?.at(-1);
            const nextResponderName = latestAssignment?.responderName ?? latestAssignment?.responder_name ?? undefined;
            setActiveResponderStatus(latestAssignment?.status ?? undefined);
            const nextAssigned = Boolean(
              latestAssignment?.responderUserId ??
              latestAssignment?.responder_user_id,
            );
            setActiveResponder(nextResponder);
            setActiveResponderName(nextResponderName);
            setResponderAssigned(nextAssigned);
          }

          setNotFound(false);
        } catch (loadError) {
          console.error(
            "Unable to load tracked request:",
            loadError,
          );

          /*
           * A network/parsing error is NOT "request not found".
           * Keep the retry screen separate from a real 404.
           */
          setError(
            loadError instanceof
            Error
              ? loadError.message
              : "Unable to load this emergency request.",
          );
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
      [
        authLoading,
        id,
        user,
      ],
    );

  /* ---------------------------------------------------------------------- */
  /* Initial load                                                           */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (
      authLoading
    ) {
      return;
    }

    if (!user) {
      setLoading(false);
      return;
    }

    if (!id) {
      setLoading(false);
      setNotFound(true);
      setError(
        "Emergency request not found.",
      );
      return;
    }

    void loadRequest();
  }, [
    authLoading,
    id,
    loadRequest,
    user,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Lightweight tracking refresh                                          */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (
      authLoading ||
      !user ||
      !id ||
      notFound ||
      !request ||
      requestIsTerminal
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () => {
          void loadRequest(true);
        },
        3_000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    authLoading,
    id,
    loadRequest,
    notFound,
    request,
    requestIsTerminal,
    user,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Map request                                                            */
  /* ---------------------------------------------------------------------- */

  const mapRequest =
    useMemo(() => {
      if (!request) {
        return undefined;
      }

      /*
       * LiveResponseMap in the existing requester GUI consumes the old
       * frontend-friendly shape. Keep that shape at the component boundary.
       */
      return {
        id:
          request.id,

        referenceCode:
          request.referenceCode,

        requesterId:
          request.requesterId,

        category:
          request.category,

        severity:
          request.severity,

        note:
          request.note,

        callbackNumber:
          request.callbackNumber,

        status:
          request.status,

        etaMinutes:
          request.etaMinutes,

        assignedResponderId:
          requestIsTerminal ? undefined : request.assignedResponderId,

        createdAt:
          request.createdAt,

        updatedAt:
          request.updatedAt,

        location:
          request.location,
      } as any;
    }, [request, requestIsTerminal]);

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                */
  /* ---------------------------------------------------------------------- */

  if (
    authLoading ||
    (!request && loading)
  ) {
    return (
      <PageSkeleton map />
    );
  }

  /*
   * If AuthProvider has not restored a user, do not pretend the request is
   * missing. The protected layout/middleware will handle the auth redirect.
   */
  if (!user) {
    return (
      <PageSkeleton map />
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Real 404                                                               */
  /* ---------------------------------------------------------------------- */

  if (
    notFound
  ) {
    return (
      <div className="app-page">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 p-8 text-center md:mx-0 md:rounded-[22px] md:border-x"
        >
          <h1 className="text-xl font-semibold text-[#102b3f]">
            {requesterText(uiLanguage, "Request not found")}
          </h1>

          <p className="mt-2 text-sm text-[#687b89]">
            {error ||
              requesterText(uiLanguage, "Emergency request not found.")}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void loadRequest()
              }
            >
              <RefreshCw className="h-4 w-4" />
              {requesterText(uiLanguage, "Try again")}
            </Button>

            <Button
              onClick={() =>
                router.push(
                  "/app/requester/history",
                )
              }
            >
              {requesterText(uiLanguage, "Back to history")}
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Load error that was NOT a 404                                         */
  /* ---------------------------------------------------------------------- */

  if (
    error &&
    !request
  ) {
    return (
      <div className="app-page">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 p-8 text-center md:mx-0 md:rounded-[22px] md:border-x"
        >
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#fff0ef] text-[#c73937]">
            <AlertCircle className="h-5 w-5" />
          </span>

          <h1 className="mt-4 text-xl font-semibold text-[#102b3f]">
            {requesterText(uiLanguage, "Unable to load request")}
          </h1>

          <p className="mx-auto mt-2 max-w-md text-sm text-[#687b89]">
            {error}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void loadRequest()
              }
            >
              <RefreshCw className="h-4 w-4" />
                {requesterText(uiLanguage, "Try again")}
            </Button>

            <Link
              href="/app/requester/history"
            >
              <Button>
                <History className="h-4 w-4" />
                {requesterText(uiLanguage, "Back to history")}
              </Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  if (!request) {
    return (
      <PageSkeleton map />
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Tracking page                                                          */
  /* ---------------------------------------------------------------------- */

  return (
    <div className={isResponder
      ? "fixed inset-0 z-[1200] flex h-[100dvh] w-full flex-col overflow-hidden bg-[#111d24] p-0 md:static md:z-auto md:grid md:h-auto md:w-auto md:gap-5 md:overflow-visible md:bg-transparent md:p-8"
      : "flex h-[calc(100dvh-4rem-5rem)] flex-col gap-0 overflow-hidden p-0 md:grid md:h-auto md:gap-5 md:p-8"}>
      {isResponder ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1100] flex items-center justify-between gap-3 px-4 pb-3 md:hidden" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
            <button type="button" onClick={() => router.push("/app/responder")} aria-label={requesterText(uiLanguage, "Back to mission")} className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/20 bg-[#112630]/95 text-white shadow-lg backdrop-blur-sm transition hover:bg-[#1a3946]">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span
              role="status"
              aria-live="polite"
              className={`max-w-[70%] truncate rounded-full border px-4 py-2 text-sm font-bold capitalize shadow-lg backdrop-blur-sm ${
                responderIsNear
                  ? "border-[#e5bc38] bg-[#f2c94c]"
                  : responderHasArrived
                    ? "border-[#d53f3d] bg-[#d53f3d]"
                    : "border-white/20 bg-[#112630]/95"
              }`}
              style={{ color: responderIsNear ? "#3f2e00" : "#ffffff" }}
            >
              {mobileTrackingStatus}
            </span>
        </div>
      ) : null}
      {isResponder && canCallRequester ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1100] px-4 pt-3 md:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
              <Button type="button" size="lg" className="pointer-events-auto w-full shadow-xl" disabled={call.status !== "idle"} onClick={callRequester}>
                <PhoneCall className="h-5 w-5" />{requesterText(uiLanguage, "Call requester")}
              </Button>
        </div>
      ) : null}
      <div className="hidden md:block">
      <PageHeading
        eyebrow={requesterText(uiLanguage, "Emergency request")}
        title={request.referenceCode}
        description={`${requesterText(uiLanguage, request.category)} · ${requesterText(uiLanguage, request.severity)} ${requesterText(uiLanguage, "priority")}`}
        action={request.status.toLowerCase() !== "submitted" ? (
          <Badge
            tone={requestStatusTone(
              request.status as any,
            )}
            className="min-h-9 px-4"
          >
            {requesterText(uiLanguage, request.status.replace(/_/g, " "))}
          </Badge>
        ) : undefined}
      />
      </div>

      <div className="min-h-0 flex-1 grid gap-0 md:flex-none md:grid-cols-[1.3fr_.7fr] md:gap-4">
        <LiveResponseMap
          request={mapRequest}
          uiLanguage={uiLanguage}
          responder={requestIsTerminal ? undefined : activeResponder}
          responderAssigned={!requestIsTerminal && responderAssigned}
          responderName={requestIsTerminal ? undefined : activeResponderName}
          responderStatus={requestIsTerminal ? undefined : activeResponderStatus}
          responderDistanceMetres={trackingDistanceMetres}
          responderMode={isResponder && isMobileViewport}
          immersive
          compactRequestDetails
          hideActiveRequestDetailsMobile={isResponder}
          mapStatusOffsetClassName={isResponder && isMobileViewport ? "top-[4.5rem] sm:top-[4.5rem]" : undefined}
          mapControlsOffsetClassName={isResponder && isMobileViewport ? "top-[4.5rem] sm:top-[4.5rem]" : undefined}
          showMyLocation={!isResponder || !isMobileViewport}
          mobileAction={isRequester && !requestIsTerminal ? (
            <CancelRequestButton
              key={request.id}
              requestId={request.id}
              status={request.status}
              language={uiLanguage}
              requestedAlready={Boolean(request.cancellationRequestedAt)}
              onRequested={() => void loadRequest(true)}
            />
          ) : canCallRequester ? (
            <Button type="button" size="lg" className="w-full" disabled={call.status !== "idle"} onClick={callRequester}>
              <PhoneCall className="h-5 w-5" />{requesterText(uiLanguage, "Call requester")}
            </Button>
          ) : undefined}
          className="h-full min-h-0 w-full rounded-none md:h-[62dvh] md:min-h-[480px] md:rounded-[22px]"
        />

        <div className="hidden content-start gap-4 md:grid">
          <Panel>
            <PanelHeader
              title={requesterText(uiLanguage, "Request status")}
              description={requesterText(uiLanguage, "LIVE will show changes to your emergency request here.")}
              action={canCallRequester ? (
                <Button type="button" size="sm" disabled={call.status !== "idle"} onClick={callRequester}>
                  <PhoneCall className="h-4 w-4" />{requesterText(uiLanguage, "Call requester")}
                </Button>
              ) : undefined}
            />

            <div className="grid gap-3 p-5">
              <div className="border-t border-[#e2e8ed] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                  {requesterText(uiLanguage, "Incident")}
                </p>

                <p className="mt-1 font-semibold text-[#102b3f]">
                  {requesterText(uiLanguage, request.category)}
                </p>

                <p className="mt-2 text-sm leading-6 text-[#5f7482]">
                  {request.note === "No incident note provided." ? requesterText(uiLanguage, request.note) : request.note}
                </p>
              </div>

              <div className="border-t border-[#e2e8ed] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                  {requesterText(uiLanguage, "Confirmed location")}
                </p>

                <p className="mt-1 text-sm font-semibold text-[#102b3f]">
                  {request.location.address}
                </p>

                {typeof request.location.lat ===
                  "number" &&
                typeof request.location.lng ===
                  "number" ? (
                  <p className="mt-1 text-xs text-[#71828d]">
                    {request.location.lat.toFixed(
                      6,
                    )}
                    ,{" "}
                    {request.location.lng.toFixed(
                      6,
                    )}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-[#e2e8ed] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div key={activityIndex} className="activity-status-transition">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">{requesterText(uiLanguage, "Activity")}</p>
                    <p className="mt-1 font-semibold capitalize text-[#102b3f]">
                      {requesterText(uiLanguage, (request.history[activityIndex]?.status ?? request.status).replace(/_/g, " "))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={requesterText(uiLanguage, "View newer status")} disabled={activityIndex === 0} onClick={() => setActivityIndex((index) => Math.max(0, index - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce5ea] text-[#0f5b67] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" aria-label={requesterText(uiLanguage, "View older status")} disabled={activityIndex >= request.history.length - 1} onClick={() => setActivityIndex((index) => Math.min(request.history.length - 1, index + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce5ea] text-[#0f5b67] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-[#84949d]">
                  {request.history[activityIndex] ? formatDateTime(request.history[activityIndex].createdAt, uiLanguage) : formatDateTime(request.createdAt, uiLanguage)}
                </p>
                {request.history[activityIndex]?.note ? <p className="mt-2 text-sm leading-5 text-[#5f7482]">{requesterText(uiLanguage, request.history[activityIndex].note)}</p> : null}
              </div>

            </div>
          </Panel>

          {isRequester ? (
            <CancelRequestButton
              key={request.id}
              requestId={request.id}
              status={request.status}
              language={uiLanguage}
              requestedAlready={Boolean(request.cancellationRequestedAt)}
              onRequested={() => void loadRequest(true)}
            />
          ) : null}

        </div>
      </div>
    </div>
  );
}

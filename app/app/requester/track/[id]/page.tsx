"use client";

import Link from "next/link";
import {
  AlertCircle,
  Clock3,
  History,
  MapPin,
  RefreshCw,
  Siren,
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

type ApiRequest = {
  id: string;

  /* Middleware/canonical fields */
  reference?: string;
  requesterId?: string;
  currentStatus?: EmergencyStatus;
  callbackNumber?: string | null;
  etaMinutes?: number | null;
  createdAt?: string;
  updatedAt?: string;
  location?: ApiLocation | null;
  statusHistory?: StatusHistoryItem[];
  history?: StatusHistoryItem[];

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
  etaMinutes?: number;
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

    etaMinutes:
      request.etaMinutes ??
      request.eta_minutes ??
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
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
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

  const id =
    typeof params?.id === "string"
      ? params.id
      : "";

  const [
    request,
    setRequest,
  ] =
    useState<UiRequest | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

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
            await fetch(
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

          setRequest(
            normalizeRequest(
              apiRequest,
            ),
          );

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
      !request
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () => {
          void loadRequest(true);
        },
        15_000,
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

        createdAt:
          request.createdAt,

        updatedAt:
          request.updatedAt,

        location:
          request.location,
      } as any;
    }, [request]);

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                */
  /* ---------------------------------------------------------------------- */

  if (
    authLoading ||
    loading
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
            Request not found
          </h1>

          <p className="mt-2 text-sm text-[#687b89]">
            {error ||
              "Emergency request not found."}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void loadRequest()
              }
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>

            <Button
              onClick={() =>
                router.push(
                  "/app/requester/history",
                )
              }
            >
              Back to history
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
            Unable to load request
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
              Try again
            </Button>

            <Link
              href="/app/requester/history"
            >
              <Button>
                <History className="h-4 w-4" />
                Back to history
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
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Emergency request"
        title={request.referenceCode}
        description={`${request.category} · ${request.severity} priority`}
        action={
          <Badge
            tone={requestStatusTone(
              request.status as any,
            )}
            className="min-h-9 px-4"
          >
            {request.status}
          </Badge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <LiveResponseMap
          request={mapRequest}
          immersive
          className="h-[48dvh] min-h-[360px] md:h-[62dvh] md:min-h-[480px]"
        />

        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader
              title="Request status"
              description="LIVE will show changes to your emergency request here."
            />

            <div className="grid gap-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#f2f6f8] p-3">
                  <Clock3 className="h-4 w-4 text-[#0f5b67]" />

                  <p className="mt-2 text-xs font-semibold text-[#748693]">
                    Estimated arrival
                  </p>

                  <p className="mt-1 font-semibold text-[#102b3f]">
                    {request.etaMinutes
                      ? `${request.etaMinutes} min`
                      : "Pending"}
                  </p>
                </div>

                <div className="rounded-xl bg-[#f2f6f8] p-3">
                  <MapPin className="h-4 w-4 text-[#0f5b67]" />

                  <p className="mt-2 text-xs font-semibold text-[#748693]">
                    Location
                  </p>

                  <p className="mt-1 truncate font-semibold text-[#102b3f]">
                    {request.location.method}
                  </p>
                </div>
              </div>

              <div className="border-t border-[#e2e8ed] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                  Incident
                </p>

                <p className="mt-1 font-semibold text-[#102b3f]">
                  {request.category}
                </p>

                <p className="mt-2 text-sm leading-6 text-[#5f7482]">
                  {request.note}
                </p>
              </div>

              <div className="border-t border-[#e2e8ed] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                  Confirmed location
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
                <p className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                  Submitted
                </p>

                <p className="mt-1 text-sm text-[#5f7482]">
                  {formatDateTime(
                    request.createdAt,
                  )}
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    void loadRequest()
                  }
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>

                <Link
                  href="/app/requester/history"
                  className="flex-1"
                >
                  <Button
                    className="w-full"
                  >
                    <History className="h-4 w-4" />
                    History
                  </Button>
                </Link>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Activity"
              description="Latest request updates."
            />

            <div className="p-5">
              {request.history.length >
              0 ? (
                <div className="grid gap-4">
                  {request.history.map(
                    (
                      item,
                    ) => (
                      <div
                        key={
                          item.id
                        }
                        className="flex gap-3"
                      >
                        <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-[#0f5b67]">
                          <Siren className="h-4 w-4" />
                        </span>

                        <div className="min-w-0">
                          <p className="font-semibold capitalize text-[#102b3f]">
                            {item.status.replace(
                              /_/g,
                              " ",
                            )}
                          </p>

                          {item.note ? (
                            <p className="mt-1 text-sm text-[#607581]">
                              {
                                item.note
                              }
                            </p>
                          ) : null}

                          <p className="mt-1 text-xs text-[#84949d]">
                            {formatDateTime(
                              item.createdAt,
                            )}
                          </p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="py-3 text-sm text-[#687b89]">
                  Your request has been submitted. New status updates will appear here.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

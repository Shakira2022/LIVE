"use client";

import {
  ChevronRight,
  Clock3,
  MapPin,
  PhoneCall,
  Siren,
  Loader2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LiveResponseMap } from "@/components/maps/live-response-map";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  isActiveStatus,
  requestStatusTone,
} from "@/lib/utils";
import type { RequestStatus } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type EmergencyStatus =
  | "submitted"
  | "received"
  | "assigned"
  | "en_route"
  | "arrived"
  | "closed"
  | "cancelled"
  | "rejected";

function toUiStatus(
  status: EmergencyStatus,
): RequestStatus {
  const statusMap: Record<
    EmergencyStatus,
    RequestStatus
  > = {
    submitted: "Submitted",
    received: "Received",
    assigned: "Assigned",
    en_route: "En route",
    arrived: "Arrived",
    closed: "Closed",
    cancelled: "Cancelled",
    rejected: "Rejected",
  };

  return statusMap[status];
}

type ApiRequest = {
  id: string;
  reference_code?: string;
  requester_id?: string;
  category: string;
  severity: string;
  note?: string | null;
  callback_number?: string | null;
  current_status: EmergencyStatus;
  eta_minutes?: number | null;

  request_locations?:
    | {
        latitude: number;
        longitude: number;
        accuracy_meters?: number | null;
        address_text?: string | null;
        location_method?: string;
        captured_at?: string;
      }[]
    | {
        latitude: number;
        longitude: number;
        accuracy_meters?: number | null;
        address_text?: string | null;
        location_method?: string;
        captured_at?: string;
      }
    | null;

  request_status_history?: Array<{
    id: string;
    previous_status?: EmergencyStatus | null;
    new_status: EmergencyStatus;
    note?: string | null;
    actor_role?: string | null;
    changed_by_system?: boolean;
    created_at: string;
  }>;
};

type TrackingRequest = {
  /*
   * Database UUID.
   *
   * Used internally when talking to the API.
   */
  id: string;

  /*
   * Human-readable LIVE reference.
   *
   * Example:
   * LIVE-1786490501079
   */
  referenceCode: string;

  category: string;
  severity: string;
  note: string;
  callbackNumber: string;
  status: RequestStatus;
  etaMinutes?: number;

  location: {
    address: string;
    method: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
  };

  statusHistory: Array<{
    id: string;
    status: RequestStatus;
    note?: string;
    createdAt: string;
  }>;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getLocation(
  locations: ApiRequest["request_locations"],
) {
  if (!locations) {
    return null;
  }

  if (Array.isArray(locations)) {
    return locations[0] ?? null;
  }

  return locations;
}

function convertApiRequest(
  apiRequest: ApiRequest,
): TrackingRequest {
  const location = getLocation(
    apiRequest.request_locations,
  );

  return {
    /*
     * KEEP THE REAL DATABASE UUID.
     *
     * The API can use this UUID for:
     *
     * GET  /api/requests/<uuid>
     * PATCH /api/requests/<uuid>
     */
    id: apiRequest.id,

    /*
     * Human-readable reference shown to requester.
     */
    referenceCode:
      apiRequest.reference_code ||
      apiRequest.id,

    category: apiRequest.category,

    severity: apiRequest.severity,

    note:
      apiRequest.note ||
      "No additional description provided.",

    callbackNumber:
      apiRequest.callback_number ||
      "Not provided",

    status: toUiStatus(
      apiRequest.current_status,
    ),

    etaMinutes:
      apiRequest.eta_minutes ??
      undefined,

    location: {
      address:
        location?.address_text ||
        "Location confirmed",

      method:
        location?.location_method ||
        "gps",

      lat: location?.latitude,

      lng: location?.longitude,

      accuracy:
        location?.accuracy_meters ??
        undefined,
    },

    statusHistory: (
      apiRequest.request_status_history ||
      []
    ).map((entry) => ({
      id: entry.id,
      status: toUiStatus(
        entry.new_status,
      ),
      note:
        entry.note ||
        undefined,
      createdAt: entry.created_at,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function TrackRequest() {
  const params =
    useParams<{ id: string }>();

  /*
   * The URL can contain either:
   *
   * UUID:
   * 54c36827-4b93-4606-8dd1-7b7bcae23afe
   *
   * OR:
   * LIVE-1786490501079
   */
  const id = params?.id;

  const router = useRouter();

  const [request, setRequest] =
    useState<TrackingRequest | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [loadError, setLoadError] =
    useState("");

  const [detailsOpen, setDetailsOpen] =
    useState(false);

  const [statusOpen, setStatusOpen] =
    useState(false);

  const [cancelling, setCancelling] =
    useState(false);

  /* ---------------------------------------------------------------------- */
  /* Load request                                                            */
  /* ---------------------------------------------------------------------- */

  async function loadRequest() {
    if (!id) {
      setLoading(false);
      setLoadError(
        "Request ID is missing.",
      );
      return;
    }

    try {
      setLoading(true);
      setLoadError("");

      /*
       * IMPORTANT:
       *
       * We are NOT requiring JWT here.
       *
       * The old requester flow uses the
       * request ID/reference from the URL.
       */
      const response = await fetch(
        `/api/requests/${encodeURIComponent(
          id,
        )}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      let data: {
        request?: ApiRequest;
        error?: string;
      } | null = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Emergency request not found.",
        );
      }

      if (!data?.request) {
        throw new Error(
          "Emergency request not found.",
        );
      }

      const converted =
        convertApiRequest(
          data.request,
        );

      setRequest(converted);
    } catch (error) {
      console.error(
        "Failed to load emergency request:",
        error,
      );

      setRequest(null);

      setLoadError(
        error instanceof Error
          ? error.message
          : "Emergency request could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequest();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ---------------------------------------------------------------------- */
  /* Loading state                                                           */
  /* ---------------------------------------------------------------------- */

  if (loading) {
    return <PageSkeleton map />;
  }

  /* ---------------------------------------------------------------------- */
  /* Error state                                                             */
  /* ---------------------------------------------------------------------- */

  if (!request) {
    return (
      <div className="app-page">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 p-8 text-center md:mx-0 md:rounded-[22px] md:border-x"
        >
          <h1 className="text-xl font-semibold">
            Request not found
          </h1>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#687b89]">
            {loadError ||
              "This emergency request could not be found."}
          </p>

          <div className="mt-5 flex justify-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void loadRequest()
              }
            >
              Try again
            </Button>

            <Button
              onClick={() =>
                router.replace(
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
  /* Active request                                                          */
  /* ---------------------------------------------------------------------- */

  const hasActiveRequest =
    isActiveStatus(
      request.status,
    );

  /* ---------------------------------------------------------------------- */
  /* Cancellation                                                            */
  /* ---------------------------------------------------------------------- */

  async function requestCancellation() {
    if (
      !request ||
      cancelling
    ) {
      return;
    }

    try {
      setCancelling(true);

      /*
       * Use the REAL database UUID.
       *
       * Example:
       *
       * /api/requests/54c36827-4b93-4606-8dd1-7b7bcae23afe
       *
       * The backend also supports LIVE references,
       * but once the request is loaded we have the
       * real UUID available.
       */
      const response = await fetch(
        `/api/requests/${encodeURIComponent(
          request.id,
        )}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            status: "cancelled",

            note:
              "Cancellation requested by requester.",
          }),
        },
      );

      let data: {
        request?: ApiRequest;
        error?: string;
      } | null = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "The request could not be cancelled.",
        );
      }

      await loadRequest();
    } catch (error) {
      console.error(
        "Failed to cancel request:",
        error,
      );

      setLoadError(
        error instanceof Error
          ? error.message
          : "The request could not be cancelled.",
      );
    } finally {
      setCancelling(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Map request                                                             */
  /* ---------------------------------------------------------------------- */

  const mapRequest = {
    ...request,

    location: {
      ...request.location,

      address:
        request.location.address,
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="md:grid md:gap-5">
      {/* Desktop heading */}

      <div className="hidden md:block">
        <PageHeading
          eyebrow="Live tracking"
          title={
            request.referenceCode
          }
          description={`${request.category} · ${request.severity} priority`}
          action={
            <Badge
              tone={requestStatusTone(
                request.status,
              )}
              className="min-h-9 px-4"
            >
              {request.status}
            </Badge>
          }
        />
      </div>

      <div
        className="
          fixed inset-x-0
          bottom-[calc(5.75rem+env(safe-area-inset-bottom))]
          top-20 z-10
          flex min-h-0 flex-col
          overflow-hidden
          bg-[#f5f7f9]

          md:static
          md:z-auto
          md:grid
          md:grid-cols-[1.35fr_.65fr]
          md:gap-4
          md:overflow-visible
          md:bg-transparent
        "
      >
        {/* Mobile status control */}

        <button
          type="button"
          onClick={() =>
            setStatusOpen(true)
          }
          className="
            flex h-14 shrink-0 items-center
            gap-3
            border-b border-[#dce5ea]
            bg-white px-4 text-left
            md:hidden
          "
          aria-label="Open response status"
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0f6872]/35" />

            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#0f6872]" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[#102b3f]">
              {request.status}

              {request.etaMinutes
                ? ` · ETA ${request.etaMinutes} min`
                : " · ETA pending"}
            </span>
          </span>

          <span className="text-xs font-semibold text-[#0f6872]">
            Updates
          </span>

          <ChevronRight className="h-4 w-4 shrink-0 text-[#0f6872]" />
        </button>

        {/* Map */}

        <div className="min-h-0 flex-1 overflow-hidden md:h-auto md:overflow-visible">
          <LiveResponseMap
            request={
              mapRequest as any
            }
            responder={undefined}
            immersive
            className="
              h-full min-h-0 w-full
              rounded-none

              md:h-[72dvh]
              md:min-h-[500px]
              md:rounded-[22px]
            "
            mobileAction={
              <div
                className={
                  hasActiveRequest
                    ? "grid grid-cols-2 gap-2"
                    : "grid grid-cols-1 gap-2"
                }
              >
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setDetailsOpen(
                      true,
                    )
                  }
                >
                  Request details
                </Button>

                {hasActiveRequest ? (
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={
                      requestCancellation
                    }
                    disabled={
                      cancelling
                    }
                  >
                    {cancelling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      "Cancel request"
                    )}
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>

        {/* Desktop response information */}

        <div className="hidden content-start gap-4 md:grid">
          <Panel>
            <PanelHeader
              title="Response status"
              description={
                request.etaMinutes
                  ? `Estimated arrival in ${request.etaMinutes} minutes`
                  : "No trusted ETA is currently available"
              }
            />

            <StatusTimeline
              entries={
                request.statusHistory as any
              }
            />
          </Panel>

          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              setDetailsOpen(
                true,
              )
            }
          >
            View request details
          </Button>

          {hasActiveRequest ? (
            <Button
              variant="danger"
              className="w-full"
              onClick={
                requestCancellation
              }
              disabled={
                cancelling
              }
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Request cancellation"
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Mobile status sheet */}

      <Sheet
        open={statusOpen}
        onOpenChange={
          setStatusOpen
        }
        title="Response status"
        description={
          request.referenceCode
        }
        className="max-h-[82dvh]"
      >
        <div className="border-b border-[#e2e8ed] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#758792]">
                Current update
              </p>

              <p className="mt-1 text-lg font-semibold text-[#102b3f]">
                {request.status}
              </p>
            </div>

            <Badge
              tone={requestStatusTone(
                request.status,
              )}
            >
              {request.etaMinutes
                ? `ETA ${request.etaMinutes} min`
                : "ETA pending"}
            </Badge>
          </div>
        </div>

        <div className="max-h-[calc(82dvh-9rem)] overflow-y-auto">
          <StatusTimeline
            entries={
              request.statusHistory as any
            }
          />
        </div>
      </Sheet>

      {/* Request details sheet */}

      <Sheet
        open={detailsOpen}
        onOpenChange={
          setDetailsOpen
        }
        title="Request details"
        description={
          request.referenceCode
        }
      >
        <div className="p-5">
          <dl className="divide-y divide-[#e2e8ed] border-y border-[#e2e8ed]">
            {/* Location */}

            <div className="flex gap-3 py-4">
              <MapPin className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Location
                </dt>

                <dd className="mt-1 font-semibold">
                  {
                    request
                      .location
                      .address
                  }
                </dd>

                <dd className="mt-1 text-xs text-[#71828d]">
                  {
                    request
                      .location
                      .method
                  }
                </dd>

                {request.location
                  .lat !==
                    undefined &&
                request.location
                  .lng !==
                    undefined ? (
                  <dd className="mt-1 text-xs text-[#71828d]">
                    {request.location.lat.toFixed(
                      6,
                    )}
                    ,{" "}
                    {request.location.lng.toFixed(
                      6,
                    )}
                  </dd>
                ) : null}

                {request.location
                  .accuracy !==
                    undefined ? (
                  <dd className="mt-1 text-xs text-[#71828d]">
                    Accuracy: ±
                    {Math.round(
                      request.location
                        .accuracy,
                    )}
                    m
                  </dd>
                ) : null}
              </div>
            </div>

            {/* Callback */}

            <div className="flex gap-3 py-4">
              <PhoneCall className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Callback
                </dt>

                <dd className="mt-1 font-semibold">
                  {
                    request.callbackNumber
                  }
                </dd>
              </div>
            </div>

            {/* Incident note */}

            <div className="flex gap-3 py-4">
              <Siren className="h-5 w-5 shrink-0 text-[#d53f3d]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Incident note
                </dt>

                <dd className="mt-1 leading-6">
                  {request.note}
                </dd>
              </div>
            </div>

            {/* Status */}

            <div className="flex gap-3 py-4">
              <Clock3 className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Current status
                </dt>

                <dd className="mt-1 font-semibold">
                  {request.status}
                </dd>
              </div>
            </div>
          </dl>

          <div className="mt-5 border-l-4 border-[#d9a85d] bg-[#fff6e6] p-4 text-sm leading-6 text-[#78521e]">
            LIVE is a prototype. It must
            not be interpreted as
            confirmation that real emergency
            services have been contacted.
          </div>
        </div>
      </Sheet>
    </div>
  );
}
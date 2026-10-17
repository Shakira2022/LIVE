
"use client";

import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { RequestListItem } from "@/components/requests/request-list-item";
import { RequestDetailsSheet } from "@/components/requests/request-details-sheet";

import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";

import { PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { requestStatusTone } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
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
  locationMethod?: string | null;
  location_method?: string | null;
  capturedAt?: string | null;
  captured_at?: string | null;
};

type ApiRequest = {
  id: string;

  // Middleware/canonical names
  reference?: string;
  requesterId?: string;
  currentStatus?: EmergencyStatus;
  callbackNumber?: string | null;
  etaMinutes?: number | null;
  createdAt?: string;
  updatedAt?: string;
  location?: ApiLocation | null;

  // Old backend names kept as temporary fallbacks
  reference_code?: string;
  requester_id?: string;
  current_status?: EmergencyStatus;
  callback_number?: string | null;
  eta_minutes?: number | null;
  created_at?: string;
  updated_at?: string;
  request_locations?: ApiLocation[] | ApiLocation | null;

  category: string;
  severity: string;
  note?: string | null;
};

type RequestListEnvelope = {
  ok?: boolean;
  data?: {
    items?: ApiRequest[];
    total?: number;
    limit?: number;
    offset?: number;
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getLocation(request: ApiRequest): ApiLocation | null {
  if (request.location) {
    return request.location;
  }

  const locations = request.request_locations;

  if (!locations) {
    return null;
  }

  if (Array.isArray(locations)) {
    return locations[0] ?? null;
  }

  return locations;
}

function getApiErrorMessage(
  payload: RequestListEnvelope | null,
  fallback: string,
) {
  if (!payload) return fallback;

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error === "object"
  ) {
    const details = payload.error.details;
    const firstDetail = details
      ? Object.values(details).flat().find(Boolean)
      : undefined;

    return (
      firstDetail ||
      payload.error.message ||
      payload.message ||
      fallback
    );
  }

  return payload.message || fallback;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function RequestHistory() {
  const { user } = useAuth();

  const [requests, setRequests] = useState<ApiRequest[]>(() =>
    user?.id
      ? readCached<ApiRequest[]>(`requester-history:${user.id}`) ?? []
      : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Load request history                                                   */
  /* ---------------------------------------------------------------------- */

  async function loadRequests() {
    if (!user) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const cacheKey = `requester-history:${user.id}`;
    const cached = readFreshCache<ApiRequest[]>(cacheKey);
    if (cached) {
      setRequests(cached);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");

      /*
       * Ownership comes from the authenticated JWT.
       * Do not send phone/requesterId filters from the browser.
       */
      const response = await fetch(
        "/api/requests?limit=100&offset=0",
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      let data: RequestListEnvelope | null = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      console.log(
        "REQUEST HISTORY STATUS:",
        response.status,
      );

      console.log(
        "REQUEST HISTORY API RESPONSE:",
        data,
      );

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(
            data,
            `Failed to load request history. Server returned ${response.status}.`,
          ),
        );
      }

      /*
       * Current middleware shape:
       * { ok: true, data: { items: [...] } }
       *
       * The other two fallbacks make the page tolerant while the
       * rest of the old backend UI is being migrated.
       */
      const nextRequests =
        data?.data?.items ??
        data?.items ??
        data?.requests ??
        [];

      const normalizedRequests = Array.isArray(nextRequests) ? nextRequests : [];
      setRequests(normalizedRequests);
      writeFreshCache(cacheKey, normalizedRequests, 5 * 60_000);
    } catch (error) {
      console.error(
        "Failed to load request history:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Failed to load request history.",
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Load when user is available                                            */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!user) {
      setRequests([]);
      setLoading(false);
      return;
    }

    void loadRequests();

    // loadRequests intentionally uses user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */

  if (!user) {
    return <PageSkeleton />;
  }

  /* ---------------------------------------------------------------------- */
  /* Error                                                                   */
  /* ---------------------------------------------------------------------- */

  if (error) {
    return (
      <div className="app-page !pt-0 grid gap-5">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 p-8 text-center md:mx-0 md:rounded-[22px] md:border-x"
        >
          <h2 className="text-lg font-semibold text-[#102b3f]">
            Unable to load request history
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm text-[#687b89]">
            {error}
          </p>

          <Button
            variant="outline"
            className="mt-5"
            onClick={() => void loadRequests()}
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </Panel>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Convert API data                                                       */
  /* ---------------------------------------------------------------------- */

  const items = [...requests]
    .sort((a, b) => {
      const bDate =
        b.updatedAt ??
        b.updated_at ??
        b.createdAt ??
        b.created_at ??
        "";

      const aDate =
        a.updatedAt ??
        a.updated_at ??
        a.createdAt ??
        a.created_at ??
        "";

      return (
        new Date(bDate).getTime() -
        new Date(aDate).getTime()
      );
    })
    .map((request) => {
      const location = getLocation(request);

      const createdAt =
        request.createdAt ??
        request.created_at ??
        new Date().toISOString();

      const updatedAt =
        request.updatedAt ??
        request.updated_at ??
        createdAt;

      return {
        id: request.id,

        referenceCode:
          request.reference ??
          request.reference_code ??
          request.id,

        requesterId:
          request.requesterId ??
          request.requester_id ??
          user.id,

        category:
          request.category,

        severity:
          request.severity,

        note:
          request.note || "",

        callbackNumber:
          request.callbackNumber ??
          request.callback_number ??
          "",

        status:
          request.currentStatus ??
          request.current_status ??
          "submitted",

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
            "Location confirmed",

          method:
            location?.locationMethod ??
            location?.location_method ??
            "gps",

          lat:
            location?.latitude ??
            undefined,

          lng:
            location?.longitude ??
            undefined,

          accuracy:
            location?.accuracyMeters ??
            location?.accuracy_meters ??
            undefined,
        },
      };
    });

  const currentRequestId = items.find((request) =>
    ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"].includes(request.status),
  )?.id ?? null;

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app-page !pt-0 grid gap-3">
      <Panel
        mobileCard={false}
        className="-mx-5 border-0 bg-white md:mx-0 md:rounded-[22px]"
      >
        <PanelHeader
          title={`${items.length} requests`}
          description="Newest activity appears first."
          className="items-center border-b-0 px-4 py-3"
        />

        {items.length > 0 ? (
          <div>
            {items.map((request) => (
              <RequestListItem
                key={request.id}
                request={request as any}
                onClick={() => setSelectedRequestId(request.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={
              <History className="h-6 w-6" />
            }
            title="No request history"
            description="Submitted emergency requests will appear here."
          />
        )}
      </Panel>
      <RequestDetailsSheet
        requestId={selectedRequestId}
        open={Boolean(selectedRequestId)}
        showTrackingButton={selectedRequestId === currentRequestId}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
      />
    </div>
  );
}

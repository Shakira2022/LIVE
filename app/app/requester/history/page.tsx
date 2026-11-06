
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { RequestListItem } from "@/components/requests/request-list-item";
import { RequestDetailsSheet } from "@/components/requests/request-details-sheet";
import { RequesterPageHelpButton } from "@/components/requester/requester-page-help-button";
import { useBlindVoiceAnnouncement } from "@/components/requester/use-blind-voice-announcement";

import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";

import { PageSkeleton } from "@/components/ui/skeleton";
import { PageHeading } from "@/components/ui/page-heading";
import { Button } from "@/components/ui/button";

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
  const uiLanguage = useRequesterLanguage(user?.id ?? "");

  const [requests, setRequests] = useState<ApiRequest[]>(() =>
    user?.id
      ? readCached<ApiRequest[]>(`requester-history:${user.id}`) ?? []
      : [],
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pendingVoiceOpenRef = useRef(false);

  /* ---------------------------------------------------------------------- */
  /* Load request history                                                   */
  /* ---------------------------------------------------------------------- */

  const loadRequests = useCallback(async (offset = 0, append = false) => {
    const sequence = ++requestSequence.current;
    if (!user) {
      setRequests([]);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    const cacheKey = `requester-history:${user.id}`;
    setError("");
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
      setRequests([]);
    }

    try {
      /*
       * Ownership comes from the authenticated JWT.
       * Do not send phone/requesterId filters from the browser.
       */
      const params = new URLSearchParams({ scope: "mine", limit: "100", offset: String(offset) });
      const response = await fetch(`/api/requests?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      let data: RequestListEnvelope | null = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

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
      if (sequence !== requestSequence.current) return;
      setRequests((current) => append ? [...current, ...normalizedRequests] : normalizedRequests);
      if (!append && offset === 0) {
        writeFreshCache(cacheKey, normalizedRequests, 5 * 60_000);
      }
      setTotal(data?.data?.total ?? normalizedRequests.length);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
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
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
        if (!append) setHasLoadedHistory(true);
      }
    }
  }, [user]);

  /* ---------------------------------------------------------------------- */
  /* Load when user is available                                            */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!user) {
      setRequests([]);
      setLoading(false);
      return;
    }

    void loadRequests(0, false);
  }, [loadRequests, user]);

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (detail?.action === "close-request-details") {
        setSelectedRequestId(null);
        return;
      }
      if (detail?.action !== "open-history-request") return;
      pendingVoiceOpenRef.current = true;
      void loadRequests(0, false);
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    if (window.sessionStorage.getItem("live-requester-voice-action-pending") === "open-history-request") {
      window.sessionStorage.removeItem("live-requester-voice-action-pending");
      pendingVoiceOpenRef.current = true;
    }
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, [loadRequests]);

  useEffect(() => {
    if (!pendingVoiceOpenRef.current || loading) return;
    pendingVoiceOpenRef.current = false;
    const firstRequest = [...requests].sort((left, right) => {
      const leftDate = left.updatedAt ?? left.updated_at ?? left.createdAt ?? left.created_at ?? "";
      const rightDate = right.updatedAt ?? right.updated_at ?? right.createdAt ?? right.created_at ?? "";
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    })[0];
    if (firstRequest) setSelectedRequestId(firstRequest.id);
  }, [loading, requests]);

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */

  if (!user) {
    return <PageSkeleton />;
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

  const historyAnnouncement = !hasLoadedHistory
    ? null
    : error
      ? requesterText(uiLanguage, "I could not load your request history. {error}", { error })
      : items.length === 0
        ? requesterText(uiLanguage, "You have no past emergency requests. Say help to start a new request.")
        : [
            requesterText(uiLanguage, "You have {count} requests in your history. The newest is first.", { count: total }),
            ...items.slice(0, 3).map((item, index) => requesterText(uiLanguage, "Request {number}: {category}, status {status}.", {
              number: index + 1,
              category: item.category,
              status: item.status.replace(/_/g, " "),
            })),
            items.length > 3 ? requesterText(uiLanguage, "Say open the first request to hear more details.") : "",
          ].filter(Boolean).join(" ");
  useBlindVoiceAnnouncement(historyAnnouncement, uiLanguage, true, user?.id);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        title={requesterText(uiLanguage, "Request history")}
        description={requesterText(uiLanguage, "Submitted and previous emergency requests appear here.")}
        action={<RequesterPageHelpButton page="history" language={uiLanguage} />}
      />

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadRequests(0, false)}>
            <RefreshCw className="h-4 w-4" />
            {requesterText(uiLanguage, "Try again")}
          </Button>
        </div>
      ) : null}

      <Panel
        mobileCard={false}
        className={items.length === 0 ? "!border-b-0 !bg-transparent md:!rounded-[22px] md:!border-b md:!bg-white" : "border-y border-[#dce5ea] bg-white md:rounded-[22px]"}
      >
        <PanelHeader
          title={requesterText(uiLanguage, total === 1 ? "One request" : "{count} requests", { count: total })}
          description={requesterText(uiLanguage, "Newest activity appears first.")}
          descriptionClassName="hidden sm:block"
          className="items-center px-4 py-3"
        />

        {loading ? <p className="px-4 py-2 text-xs text-[#667b89]">{requesterText(uiLanguage, "Updating request history…")}</p> : null}

        {items.length > 0 ? (
          <div role="region" aria-label={requesterText(uiLanguage, "Request history list")} tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            {items.map((request, index) => (
              <RequestListItem
                key={request.id}
                request={request as any}
                uiLanguage={uiLanguage}
                voiceButtonNumber={index + 1}
                onClick={() => setSelectedRequestId(request.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={
              <History className="h-6 w-6" />
            }
            title={requesterText(uiLanguage, "No requests yet")}
            description={requesterText(uiLanguage, "Submitted and previous emergency requests will appear here.")}
          />
        )}

        {items.length < total ? (
          <div className="flex justify-center border-t border-[#e2e8ed] p-4">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loadRequests(requests.length, true)}>
              {loadingMore ? requesterText(uiLanguage, "Loading…") : requesterText(uiLanguage, "Load older requests")}
            </Button>
          </div>
        ) : null}
      </Panel>
      <RequestDetailsSheet
        requestId={selectedRequestId}
        open={Boolean(selectedRequestId)}
        uiLanguage={uiLanguage}
        showTrackingButton={selectedRequestId === currentRequestId}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
      />
    </div>
  );
}

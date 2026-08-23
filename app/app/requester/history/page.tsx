
"use client";

import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { RequestListItem } from "@/components/requests/request-list-item";

import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";

import { PageHeading } from "@/components/ui/page-heading";
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
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  address_text?: string | null;
  location_method?: string | null;
  captured_at?: string | null;
};

type ApiRequest = {
  id: string;
  reference_code: string;
  requester_id: string;
  category: string;
  severity: string;
  note?: string | null;
  callback_number?: string | null;
  current_status: EmergencyStatus;
  eta_minutes?: number | null;
  created_at: string;
  updated_at: string;

  request_locations?:
    | ApiLocation[]
    | ApiLocation
    | null;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getLocation(
  locations: ApiRequest["request_locations"],
): ApiLocation | null {
  if (!locations) {
    return null;
  }

  if (Array.isArray(locations)) {
    return locations[0] ?? null;
  }

  return locations;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function RequestHistory() {
  const { user } = useAuth();

  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---------------------------------------------------------------------- */
  /* Load request history                                                   */
  /* ---------------------------------------------------------------------- */

  async function loadRequests() {
    if (!user) {
      setRequests([]);
      setLoading(false);
      return;
    }

    if (!user.phone) {
      setRequests([]);
      setLoading(false);
      setError(
        "Your account does not have a phone number. Please update your account details.",
      );
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/requests?phone=${encodeURIComponent(user.phone)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
        },
      );

      let data: {
        requests?: ApiRequest[];
        error?: string;
        message?: string;
      } | null = null;

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
          data?.error ||
            data?.message ||
            `Failed to load request history. Server returned ${response.status}.`,
        );
      }

      setRequests(
        Array.isArray(data?.requests)
          ? data.requests
          : [],
      );
    } catch (error) {
      console.error(
        "Failed to load request history:",
        error,
      );

      setRequests([]);

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

  if (loading || !user) {
    return <PageSkeleton />;
  }

  /* ---------------------------------------------------------------------- */
  /* Error                                                                   */
  /* ---------------------------------------------------------------------- */

  if (error) {
    return (
      <div className="app-page grid gap-5">
        <PageHeading
          eyebrow="Requester"
          title="Request history"
          description="Review active, completed, cancelled and rejected requests."
        />

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
    .sort(
      (a, b) =>
        new Date(
          b.updated_at || b.created_at,
        ).getTime() -
        new Date(
          a.updated_at || a.created_at,
        ).getTime(),
    )
    .map((request) => {
      const location = getLocation(
        request.request_locations,
      );

      return {
        id: request.id,

        referenceCode:
          request.reference_code,

        requesterId:
          request.requester_id,

        category:
          request.category,

        severity:
          request.severity,

        note:
          request.note || "",

        callbackNumber:
          request.callback_number || "",

        status:
          request.current_status,

        etaMinutes:
          request.eta_minutes ?? undefined,

        createdAt:
          request.created_at,

        updatedAt:
          request.updated_at,

        location: {
          address:
            location?.address_text ||
            "Location confirmed",

          method:
            location?.location_method ||
            "gps",

          lat:
            location?.latitude,

          lng:
            location?.longitude,

          accuracy:
            location?.accuracy_meters ??
            undefined,
        },
      };
    });

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Requester"
        title="Request history"
        description="Review active, completed, cancelled and rejected requests."
      />

      <Panel
        mobileCard={false}
        className="-mx-5 border-x-0 md:mx-0 md:rounded-[22px] md:border-x"
      >
        <PanelHeader
          title={`${items.length} requests`}
          description="Newest activity appears first."
          className="px-5"
        />

        {items.length > 0 ? (
          <div>
            {items.map((request) => (
              <RequestListItem
                key={request.id}
                request={request as any}
                href={`/app/requester/track/${request.id}`}
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
    </div>
  );
}

"use client";

import {
  LoaderCircle,
  RefreshCw,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AuditorListControls, auditorFilterOptions, filterAuditorRows } from "@/components/auditor/auditor-list-controls";
import { useAuth } from "@/components/auth/auth-provider";
import { RequestListItem } from "@/components/requests/request-list-item";
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
import { requestStatusTone } from "@/lib/utils";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type Incident = {
  id: string;
  referenceCode: string;
  requesterId: string;
  requesterName: string;
  category: string;
  severity: string;
  note: string;
  callbackNumber: string;
  status: string;
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

  statusHistory: Array<{
    id: string;
    status: string;
    note: string;
    createdAt: string;
  }>;
};

type IncidentResponse = {
  ok?: boolean;

  data?: {
    count?: number;
    organisationCount?: number;
    incidents?: Incident[];
  };

  count?: number;
  organisationCount?: number;
  incidents?: Incident[];

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
};

async function readJson<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function getApiMessage(
  result: IncidentResponse | null,
  fallback: string,
) {
  if (!result) {
    return fallback;
  }

  if (
    typeof result.error ===
    "string"
  ) {
    return result.error;
  }

  if (
    result.error &&
    typeof result.error ===
      "object"
  ) {
    const firstDetail =
      result.error.details
        ? Object.values(
            result.error.details,
          )
            .flat()
            .find(Boolean)
        : undefined;

    return (
      firstDetail ||
      result.error.message ||
      result.message ||
      fallback
    );
  }

  return (
    result.message ||
    fallback
  );
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response =
    await fetch(
      input,
      requestInit,
    );

  if (
    response.status !== 401
  ) {
    return response;
  }

  const refreshResponse =
    await fetch(
      "/api/auth/refresh",
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      },
    );

  if (
    !refreshResponse.ok
  ) {
    return response;
  }

  return fetch(
    input,
    requestInit,
  );
}

export default function AuditorIncidents() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const cacheKey = user?.id ? `auditor-incidents:${user.id}` : null;
  const cachedIncidents = cacheKey
    ? readCached<Incident[]>(cacheKey)
    : null;

  const [
    incidents,
    setIncidents,
  ] =
    useState<Incident[]>(() => cachedIncidents ?? []);

  const [
    openId,
    setOpenId,
  ] =
    useState<
      string | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(() => !cachedIncidents);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedIncidents = useRef(Boolean(cachedIncidents));

  const [
    error,
    setError,
  ] =
    useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadIncidents =
    useCallback(async () => {
      if (!user?.id) {
        setIncidents([]);
        setLoading(false);
        return;
      }

      try {
        if (!hasLoadedIncidents.current) setLoading(true);
        else setRefreshing(true);
        setError("");

        const response =
          await authenticatedFetch(
            "/api/auditor/incidents",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<
            IncidentResponse
          >(response);

        if (
          !response.ok
        ) {
          if (
            response.status ===
            401
          ) {
            await refresh();
          }

          if (!hasLoadedIncidents.current) setIncidents([]);

          setError(
            getApiMessage(
              result,
              "Unable to load incident records.",
            ),
          );

          return;
        }

        const nextIncidents =
          result?.data?.incidents ??
          result?.incidents ??
          [];

        setIncidents(
          Array.isArray(
            nextIncidents,
          )
            ? nextIncidents
            : [],
        );
        if (cacheKey) {
          writeFreshCache(
            cacheKey,
            Array.isArray(nextIncidents) ? nextIncidents : [],
            5 * 60_000,
          );
        }
      } catch (loadError) {
        console.warn(
          "Unable to load auditor incidents:",
          loadError instanceof
          Error
            ? loadError.message
            : String(
                loadError,
              ),
        );

        if (!hasLoadedIncidents.current) setIncidents([]);

        setError(
          "Unable to connect to the incident service.",
        );
      } finally {
        hasLoadedIncidents.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }, [
      cacheKey,
      refresh,
      user?.id,
    ]);

  useEffect(() => {
    if (
      authLoading
    ) {
      return;
    }

    if (
      !user?.id
    ) {
      setIncidents([]);
      setLoading(false);
      return;
    }

    void loadIncidents();
  }, [
    authLoading,
    loadIncidents,
    user?.id,
  ]);

  const incidentStatuses = useMemo(
    () => auditorFilterOptions(incidents.map((incident) => incident.status)),
    [incidents],
  );
  const filteredIncidents = useMemo(
    () => filterAuditorRows(incidents, {
      search,
      type: statusFilter,
      fromDate,
      toDate,
      getType: (incident) => incident.status,
      getDate: (incident) => incident.createdAt,
    }),
    [incidents, search, statusFilter, fromDate, toDate],
  );

  if (
    authLoading ||
    (loading && incidents.length === 0) ||
    !user
  ) {
    return (
      <PageSkeleton />
    );
  }

  const selected =
    incidents.find(
      (incident) =>
        incident.id ===
        openId,
    );

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Read-only review"
        title="Incident records"
        description="Open a record to review requester details and lifecycle history."
        action={
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={() =>
              void loadIncidents()
            }
          >
            {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {error ? (
        <Panel>
          <div className="p-5 text-sm text-red-600">
            {error}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Incident records" />
        <AuditorListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Reference, requester, or category"
          typeLabel="Status"
          typeValue={statusFilter}
          onTypeChange={setStatusFilter}
          typeOptions={incidentStatuses}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          visibleCount={filteredIncidents.length}
          totalCount={incidents.length}
        />

        {filteredIncidents.length > 0 ? (
          <div role="region" aria-label="Incident record results" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            {filteredIncidents.map((incident) => (
              <RequestListItem
                key={incident.id}
                request={incident as any}
                onClick={() => setOpenId(incident.id)}
              />
            ))}
          </div>
        ) : incidents.length === 0 ? (
          <div className="p-5 text-sm text-[#617582]">No incident records were found.</div>
        ) : (
          <div className="p-5 text-sm text-[#617582]">No incident records match these filters.</div>
        )}
      </Panel>

      <Sheet
        open={Boolean(
          selected,
        )}
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            setOpenId(
              null,
            );
          }
        }}
        title={
          selected?.referenceCode ||
          selected?.id ||
          "Incident"
        }
        description="Read-only incident record"
        side="right"
      >
        <div className="p-5">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold">
                    {
                      selected.category
                    }
                  </h3>

                  <p className="mt-1 text-sm text-[#687b89]">
                    {
                      selected.severity
                    }{" "}
                    priority
                  </p>
                </div>

                <Badge
                  tone={requestStatusTone(
                    selected.status as any,
                  )}
                >
                  {
                    selected.status
                  }
                </Badge>
              </div>

              <dl className="mt-5 divide-y divide-[#e2e8ed] border-y border-[#e2e8ed]">
                <div className="flex gap-3 py-4">
                  <UserRound className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Requester
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {
                        selected.requesterName
                      }
                    </dd>

                  </div>
                </div>

                <div className="py-4">
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Incident note
                  </dt>

                  <dd className="mt-2 text-sm leading-6">
                    {
                      selected.note
                    }
                  </dd>
                </div>
              </dl>

              <h4 className="mt-6 font-semibold">
                Lifecycle history
              </h4>

              <StatusTimeline
                entries={
                  selected.statusHistory as any
                }
              />
            </>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

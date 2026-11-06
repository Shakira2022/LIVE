"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditorListControls, auditorFilterOptions, filterAuditorRows } from "@/components/auditor/auditor-list-controls";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { formatDateTime } from "@/lib/utils";
import { formatApplicationEvent } from "@/lib/audit-display";
import { LogTechnicalDetails } from "@/components/auditor/log-technical-details";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type ApplicationLog = {
  id: string;
  level: string;
  service_name: string;
  event_name: string;
  message: string;
  request_id?: string | null;
  correlation_id?: string | null;
  error_code?: string | null;
  safe_context?: Record<string, unknown>;
  created_at: string;
};


type AuditorLogsEnvelope<T> = {
  ok?: boolean;
  data?: {
    type?: string;
    count?: number;
    logs?: T[];
  };
  type?: string;
  count?: number;
  logs?: T[];
  message?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

function getApiMessage<T>(
  result: AuditorLogsEnvelope<T> | null,
  fallback: string,
) {
  if (!result) {
    return fallback;
  }

  if (typeof result.error === "string") {
    return result.error;
  }

  if (
    result.error &&
    typeof result.error === "object"
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

  return result.message || fallback;
}

async function readJson<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

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

  const refreshResponse =
    await fetch(
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

function extractLogs<T>(
  result: AuditorLogsEnvelope<T> | null,
): T[] {
  const logs =
    result?.data?.logs ??
    result?.logs ??
    [];

  return Array.isArray(logs)
    ? logs
    : [];
}

export default function AuditorApplication() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();
  const cacheKey = user?.id ? `auditor-application-logs:${user.id}` : null;
  const cachedLogs = cacheKey ? readCached<ApplicationLog[]>(cacheKey) : null;
  const [logs, setLogs] = useState<ApplicationLog[]>(() => cachedLogs ?? []);
  const [loading, setLoading] = useState(() => !cachedLogs);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadApplicationLogs =
    useCallback(async () => {
      if (!user?.id) {
        setLogs([]);
        setLoading(false);
        return;
      }

      try {
        if (!cacheKey || !readCached(cacheKey)) setLoading(true);
        setError("");

        const response =
          await authenticatedFetch(
            "/api/auditor/logs?type=application",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<
            AuditorLogsEnvelope<ApplicationLog>
          >(response);

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setError(
            getApiMessage(
              result,
              "Unable to load application logs.",
            ),
          );

          return;
        }

        const nextLogs = extractLogs(result);
        setLogs(nextLogs);
        if (cacheKey) writeFreshCache(cacheKey, nextLogs, 5 * 60_000);
      } catch (error) {
        console.warn(
          "Unable to load application logs.",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load application logs.",
        );
      } finally {
        setLoading(false);
      }
    }, [
      cacheKey,
      refresh,
      user?.id,
    ]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user?.id) {
      setLogs([]);
      setLoading(false);
      return;
    }

    void loadApplicationLogs();
  }, [
    authLoading,
    loadApplicationLogs,
    user?.id,
  ]);

  const levelOptions = useMemo(
    () => auditorFilterOptions(logs.map((log) => log.level)),
    [logs],
  );
  const filteredLogs = useMemo(
    () => filterAuditorRows(logs, {
      search,
      type: levelFilter,
      fromDate,
      toDate,
      getType: (log) => log.level,
      getDate: (log) => log.created_at,
    }),
    [logs, search, levelFilter, fromDate, toDate],
  );

  function getBadgeTone(level: string) {
    switch (level.toLowerCase()) {
      case "info":
        return "blue";

      case "warning":
        return "warning";

      case "error":
      case "critical":
        return "danger";

      case "debug":
        return "slate";

      default:
        return "warning";
    }
  }

  if (authLoading || loading || !user) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Read-only review"
        title="Application logs"
        description="Review application events, service activity and system errors. No modification controls are available."
      />

      {error && (
        <Panel>
          <div className="p-5 text-sm text-red-600">
            {error}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Application event records" />
        <AuditorListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Event, service, message, request ID"
          typeLabel="Level"
          typeValue={levelFilter}
          onTypeChange={setLevelFilter}
          typeOptions={levelOptions}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          visibleCount={filteredLogs.length}
          totalCount={logs.length}
        />

        {filteredLogs.length === 0 ? (
          <div className="p-5 text-sm text-[#617582]">
            {logs.length === 0 ? "No application events were found." : "No application events match these filters."}
          </div>
        ) : (
          <div role="region" aria-label="Application log results" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            <div className="divide-y divide-[#e2e8ed]">
            {filteredLogs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      {formatApplicationEvent(log.event_name)}
                    </h2>

                    <p className="mt-1 text-sm text-[#617582]">
                      {log.service_name} · {log.message}
                    </p>

                    {log.error_code && (
                      <p className="mt-1 text-xs text-red-600">
                        Error code: {log.error_code}
                      </p>
                    )}

                    <p className="mt-2 text-xs text-[#87959e]">
                      {formatDateTime(log.created_at)} ·{" "}
                      {log.correlation_id ||
                        "No correlation ID"}
                    </p>

                    {log.request_id && (
                      <p className="mt-1 text-xs text-[#87959e]">
                        Request ID: {log.request_id}
                      </p>
                    )}

                    <LogTechnicalDetails
                      details={[
                        { label: "Original event", value: log.event_name },
                        { label: "Request ID", value: log.request_id },
                        { label: "Correlation ID", value: log.correlation_id },
                        { label: "Error code", value: log.error_code },
                        { label: "Safe technical context", value: log.safe_context },
                      ]}
                    />
                  </div>

                  <Badge tone={getBadgeTone(log.level)}>
                    {log.level}
                  </Badge>
                </div>
              </article>
            ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditorListControls, auditorFilterOptions, filterAuditorRows } from "@/components/auditor/auditor-list-controls";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { formatDateTime } from "@/lib/utils";
import { formatIntegrationOperation } from "@/lib/audit-display";
import { LogTechnicalDetails } from "@/components/auditor/log-technical-details";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type IntegrationLog = {
  id: string;
  provider_name: string;
  operation: string;
  endpoint_name?: string | null;
  http_status?: number | null;
  result: string;
  request_id?: string | null;
  correlation_id?: string | null;
  error_message?: string | null;
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

export default function AuditorIntegration() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();
  const cacheKey = user?.id ? `auditor-integration-logs:${user.id}` : null;
  const cachedLogs = cacheKey ? readCached<IntegrationLog[]>(cacheKey) : null;
  const [logs, setLogs] = useState<IntegrationLog[]>(() => cachedLogs ?? []);
  const [loading, setLoading] = useState(() => !cachedLogs);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadIntegrationLogs =
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
            "/api/auditor/logs?type=integration",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<
            AuditorLogsEnvelope<IntegrationLog>
          >(response);

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setError(
            getApiMessage(
              result,
              "Unable to load integration logs.",
            ),
          );

          return;
        }

        const nextLogs = extractLogs(result);
        setLogs(nextLogs);
        if (cacheKey) writeFreshCache(cacheKey, nextLogs, 5 * 60_000);
      } catch (error) {
        console.warn(
          "Unable to load integration logs.",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load integration logs.",
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

    void loadIntegrationLogs();
  }, [
    authLoading,
    loadIntegrationLogs,
    user?.id,
  ]);

  const resultOptions = useMemo(
    () => auditorFilterOptions(logs.map((log) => log.result)),
    [logs],
  );
  const filteredLogs = useMemo(
    () => filterAuditorRows(logs, {
      search,
      type: resultFilter,
      fromDate,
      toDate,
      getType: (log) => log.result,
      getDate: (log) => log.created_at,
    }),
    [logs, search, resultFilter, fromDate, toDate],
  );

  if (authLoading || loading || !user) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Read-only review"
        title="Integration logs"
        description="Review communication and external integration events. No modification controls are available."
      />

      {error && (
        <Panel>
          <div className="p-5 text-sm text-red-600">
            {error}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Integration event records" />
        <AuditorListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Operation, provider, endpoint, request ID"
          typeLabel="Result"
          typeValue={resultFilter}
          onTypeChange={setResultFilter}
          typeOptions={resultOptions}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          visibleCount={filteredLogs.length}
          totalCount={logs.length}
        />

        {filteredLogs.length === 0 ? (
          <div className="p-5 text-sm text-[#617582]">
            {logs.length === 0 ? "No integration events were found." : "No integration events match these filters."}
          </div>
        ) : (
          <div role="region" aria-label="Integration log results" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            <div className="divide-y divide-[#e2e8ed]">
            {filteredLogs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {log.operation
                        ? formatIntegrationOperation(log.operation)
                        : "Integration event"}
                    </h2>

                    <p className="mt-1 text-sm text-[#617582]">
                      {log.provider_name}
                      {log.endpoint_name
                       ? ` · ${log.endpoint_name}`
                       : ""}
                    </p>

                    <p className="mt-2 text-xs text-[#87959e]">
                      {formatDateTime(log.created_at)}
                      {" · "}
                      {log.correlation_id ||
                        "No correlation ID"}
                    </p>

                    {log.http_status && (
                      <p className="mt-1 text-xs text-[#617582]">
                        HTTP {log.http_status}
                      </p>
                    )}

                    {log.error_message && (
                      <p className="mt-1 text-xs text-[#617582]">
                        {log.error_message}
                      </p>
                    )}

                    <LogTechnicalDetails
                      details={[
                        { label: "Original operation", value: log.operation },
                        { label: "Provider", value: log.provider_name },
                        { label: "Endpoint", value: log.endpoint_name },
                        { label: "Request ID", value: log.request_id },
                        { label: "Correlation ID", value: log.correlation_id },
                        { label: "HTTP status", value: log.http_status },
                        { label: "Result", value: log.result },
                        { label: "Error message", value: log.error_message },
                      ]}
                    />
                  </div>

                  <Badge
                    tone={
                      log.result.toLowerCase() === "success"
                        ? "success"
                        : log.result.toLowerCase() === "denied"
                        ? "danger"
                        : "warning"
                    }
                  >
                    {log.result}
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

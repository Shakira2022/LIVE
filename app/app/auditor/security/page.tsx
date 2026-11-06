"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditorListControls, auditorFilterOptions, filterAuditorRows } from "@/components/auditor/auditor-list-controls";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { formatDateTime } from "@/lib/utils";
import { formatSecurityEvent } from "@/lib/audit-display";
import { LogTechnicalDetails } from "@/components/auditor/log-technical-details";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type SecurityLog = {
  id: string;
  user_id?: string | null;
  event_type: string;
  result: string;
  correlation_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
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

export default function AuditorSecurity() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();
  const cacheKey = user?.id ? `auditor-security-logs:${user.id}` : null;
  const cachedLogs = cacheKey ? readCached<SecurityLog[]>(cacheKey) : null;
  const [logs, setLogs] = useState<SecurityLog[]>(() => cachedLogs ?? []);
  const [loading, setLoading] = useState(() => !cachedLogs);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadSecurityLogs =
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
            "/api/auditor/logs?type=security",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<
            AuditorLogsEnvelope<SecurityLog>
          >(response);

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setError(
            getApiMessage(
              result,
              "Unable to load security logs.",
            ),
          );

          return;
        }

        const nextLogs = extractLogs(result);
        setLogs(nextLogs);
        if (cacheKey) writeFreshCache(cacheKey, nextLogs, 5 * 60_000);
      } catch (error) {
        console.warn(
          "Unable to load security logs.",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load security logs.",
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

    void loadSecurityLogs();
  }, [
    authLoading,
    loadSecurityLogs,
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
        title="Security logs"
        description="Review authentication and security-related events. No modification controls are available."
      />

      {error && (
        <Panel>
          <div className="p-5 text-sm text-red-600">
            {error}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Security event records" />
        <AuditorListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Event, user ID, IP address, correlation ID"
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
            {logs.length === 0 ? "No security events were found." : "No security events match these filters."}
          </div>
        ) : (
          <div role="region" aria-label="Security log results" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            <div className="divide-y divide-[#e2e8ed]">
            {filteredLogs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {formatSecurityEvent(log.event_type)}
                    </h2>

                    <p className="mt-1 text-sm text-[#617582]">
                      {log.user_id || "System event"} ·{" "}
                      {log.ip_address || "Unknown IP"}
                    </p>

                    <p className="mt-2 text-xs text-[#87959e]">
                      {formatDateTime(log.created_at)} ·{" "}
                      {log.correlation_id ||
                        "No correlation ID"}
                    </p>

                    <LogTechnicalDetails
                      details={[
                        { label: "Original event type", value: log.event_type },
                        { label: "User ID", value: log.user_id },
                        { label: "IP address", value: log.ip_address },
                        { label: "Correlation ID", value: log.correlation_id },
                        { label: "User agent", value: log.user_agent },
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

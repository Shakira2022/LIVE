"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditorListControls, auditorFilterOptions, filterAuditorRows } from "@/components/auditor/auditor-list-controls";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { formatDateTime } from "@/lib/utils";
import { formatAuditAction } from "@/lib/audit-display";
import { LogTechnicalDetails } from "@/components/auditor/log-technical-details";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type AuditLog = {
  id: string;
  action: string;
  target_type?: string;
  target_id?: string | null;
  result: string;
  actor_role?: string | null;
  actor_user_id?: string | null;
  correlation_id?: string;
  request_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  safe_metadata?: Record<string, unknown> | null;
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

export default function AuditorAudit() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();
  const cacheKey = user?.id ? `auditor-audit-logs:${user.id}` : null;
  const cachedLogs = cacheKey ? readCached<AuditLog[]>(cacheKey) : null;
  const [logs, setLogs] = useState<AuditLog[]>(() => cachedLogs ?? []);
  const [loading, setLoading] = useState(() => !cachedLogs);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadAuditLogs =
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
            "/api/auditor/logs?type=audit",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<
            AuditorLogsEnvelope<AuditLog>
          >(response);

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setError(
            getApiMessage(
              result,
              "Unable to load audit logs.",
            ),
          );

          return;
        }

        const nextLogs = extractLogs(result);
        setLogs(nextLogs);
        if (cacheKey) writeFreshCache(cacheKey, nextLogs, 5 * 60_000);
      } catch (error) {
        console.warn(
          "Unable to load audit logs.",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load audit logs.",
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

    void loadAuditLogs();
  }, [
    authLoading,
    loadAuditLogs,
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
        title="Audit logs"
        description="Approved security and operational events. No modification controls are available."
      />

      {error && (
        <Panel>
          <div className="p-5 text-sm text-red-600">
            {error}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Audit event records" />
        <AuditorListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Action, actor, target, request ID"
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
            {logs.length === 0 ? "No audit events were found." : "No audit events match these filters."}
          </div>
        ) : (
          <div role="region" aria-label="Audit log results" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            <div className="divide-y divide-[#e2e8ed]">
            {filteredLogs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {formatAuditAction(log.action)}
                    </h2>

                    <p className="mt-1 text-sm text-[#617582]">
                      {log.actor_role || "Unknown role"} ·{" "}
                      {log.target_type || "Unknown target"}
                      {log.target_id
                        ? ` · ${log.target_id}`
                        : ""}
                    </p>

                    <p className="mt-2 text-xs text-[#87959e]">
                      {formatDateTime(log.created_at)} ·{" "}
                      {log.correlation_id || "No correlation ID"}
                    </p>

                    <LogTechnicalDetails
                      details={[
                        { label: "Original action", value: log.action },
                        { label: "Actor user ID", value: log.actor_user_id },
                        { label: "Request ID", value: log.request_id },
                        { label: "IP address", value: log.ip_address },
                        { label: "User agent", value: log.user_agent },
                        { label: "Metadata", value: log.safe_metadata },
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

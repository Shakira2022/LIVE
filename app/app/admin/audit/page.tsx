"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";

type AuditResult =
  | "success"
  | "denied"
  | "warning"
  | "failure";

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  organisation_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  request_id: string | null;
  correlation_id: string | null;
  result: AuditResult;
  ip_address: string | null;
  user_agent: string | null;
  safe_metadata: Record<string, unknown> | null;
  created_at: string;
}

type FilterValue = "All" | "success" | "denied" | "warning" | "failure";

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterValue>("All");

  async function loadAuditLogs() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/auditor/logs?type=audit");

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setError(
          result.message || "Unable to load audit logs."
        );
        return;
      }

      setLogs(result.logs ?? []);
    } catch {
      setError(
        "Unable to connect to the audit logging service."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const filteredLogs =
    filter === "All"
      ? logs
      : logs.filter(
          (log) =>
            log.result.toLowerCase() === filter.toLowerCase()
        );

  function getBadgeTone(result: AuditResult) {
    switch (result) {
      case "success":
        return "success";

      case "denied":
        return "danger";

      case "warning":
      case "failure":
      default:
        return "warning";
    }
  }

  function formatResult(result: AuditResult) {
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  function getMetadata(log: AuditLog) {
    if (!log.safe_metadata) {
      return "—";
    }

    try {
      return JSON.stringify(log.safe_metadata);
    } catch {
      return "—";
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="Audit trail"
        description="Review recorded security and administrative activity across the platform."
      />

      {error ? (
        <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
          {error}
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title={`${filteredLogs.length} events`}
          action={
            <Select
              className="h-10 w-40"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as FilterValue)
              }
            >
              <option value="All">All</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="warning">Warning</option>
              <option value="failure">Failure</option>
            </Select>
          }
        />

        {filteredLogs.length === 0 ? (
          <div className="p-6 text-sm text-[#687b89]">
            No audit events have been recorded.
          </div>
        ) : (
          <>
            {/* Mobile */}
            <div className="grid gap-3 p-3 md:hidden">
              {filteredLogs.map((log) => (
                <article
                  key={log.id}
                  className="rounded-2xl border border-[#dfe7ec] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold">
                        {log.action}
                      </h2>

                      <p className="mt-1 text-xs text-[#71828d]">
                        {formatDateTime(log.created_at)}
                      </p>
                    </div>

                    <Badge tone={getBadgeTone(log.result)}>
                      {formatResult(log.result)}
                    </Badge>
                  </div>

                  <dl className="mt-4 grid gap-3 border-t border-[#e2e8ed] pt-3 text-xs">
                    <div>
                      <dt className="font-bold uppercase tracking-wide text-[#82919b]">
                        Actor role
                      </dt>

                      <dd className="mt-1">
                        {log.actor_role || "System"}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-bold uppercase tracking-wide text-[#82919b]">
                        Action
                      </dt>

                      <dd className="mt-1">
                        {log.action}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-bold uppercase tracking-wide text-[#82919b]">
                        Target
                      </dt>

                      <dd className="mt-1">
                        {log.target_id ||
                          log.target_type ||
                          "System"}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-bold uppercase tracking-wide text-[#82919b]">
                        Correlation
                      </dt>

                      <dd className="mt-1 break-all font-mono">
                        {log.correlation_id || "—"}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-bold uppercase tracking-wide text-[#82919b]">
                        Metadata
                      </dt>

                      <dd className="mt-1 break-all text-[#617582]">
                        {getMetadata(log)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            {/* Desktop */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-y border-[#e2e8ed] bg-[#f7f9fa] text-xs uppercase tracking-wide text-[#70838f]">
                  <tr>
                    <th className="px-5 py-3">
                      Time
                    </th>

                    <th className="px-5 py-3">
                      Actor
                    </th>

                    <th className="px-5 py-3">
                      Action
                    </th>

                    <th className="px-5 py-3">
                      Target
                    </th>

                    <th className="px-5 py-3">
                      Correlation
                    </th>

                    <th className="px-5 py-3">
                      Result
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#e2e8ed]">
                  {filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap px-5 py-4 text-xs text-[#71828d]">
                        {formatDateTime(log.created_at)}
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-semibold">
                          {log.actor_role || "System"}
                        </p>

                        <p className="text-xs text-[#71828d]">
                          {log.actor_user_id || "System"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-semibold">
                          {log.action}
                        </p>

                        <p className="mt-1 max-w-sm break-all text-xs text-[#71828d]">
                          {getMetadata(log)}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-medium">
                          {log.target_type}
                        </p>

                        {log.target_id ? (
                          <p className="mt-1 break-all text-xs text-[#71828d]">
                            {log.target_id}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-5 py-4 font-mono text-xs">
                        {log.correlation_id || "—"}
                      </td>

                      <td className="px-5 py-4">
                        <Badge tone={getBadgeTone(log.result)}>
                          {formatResult(log.result)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
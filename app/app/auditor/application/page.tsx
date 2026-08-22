"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";

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

export default function AuditorApplication() {
  const [logs, setLogs] = useState<ApplicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadApplicationLogs() {
      try {
        setLoading(true);

        const response = await fetch(
          "/api/auditor/logs?type=application",
          {
            method: "GET",
            credentials: "include",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || "Failed to load application logs."
          );
        }

        setLogs(data.logs || []);
      } catch (error) {
        console.error(
          "Failed to load application logs:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load application logs."
        );
      } finally {
        setLoading(false);
      }
    }

    loadApplicationLogs();
  }, []);

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

  if (loading) {
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
        <PanelHeader title={`${logs.length} events`} />

        {logs.length === 0 && !error ? (
          <div className="p-5 text-sm text-[#617582]">
            No application events were found.
          </div>
        ) : (
          <div className="divide-y divide-[#e2e8ed]">
            {logs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      {log.event_name}
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
                  </div>

                  <Badge tone={getBadgeTone(log.level)}>
                    {log.level}
                  </Badge>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
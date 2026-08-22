"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";

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

export default function AuditorIntegration() {
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadIntegrationLogs() {
      try {
        setLoading(true);

        const response = await fetch(
          "/api/auditor/logs?type=integration",
          {
            method: "GET",
            credentials: "include",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || "Failed to load integration logs."
          );
        }

        setLogs(data.logs || []);
      } catch (error) {
        console.error(
          "Failed to load integration logs:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load integration logs."
        );
      } finally {
        setLoading(false);
      }
    }

    loadIntegrationLogs();
  }, []);

  if (loading) {
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
        <PanelHeader title={`${logs.length} events`} />

        {logs.length === 0 && !error ? (
          <div className="p-5 text-sm text-[#617582]">
            No integration events were found.
          </div>
        ) : (
          <div className="divide-y divide-[#e2e8ed]">
            {logs.map((log) => (
              <article
                key={log.id}
                className="p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {log.operation || "Integration event"}
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
        )}
      </Panel>
    </div>
  );
}
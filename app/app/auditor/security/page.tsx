"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";

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

export default function AuditorSecurity() {
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSecurityLogs() {
      try {
        setLoading(true);

        const response = await fetch(
          "/api/auditor/logs?type=security",
          {
            method: "GET",
            credentials: "include",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || "Failed to load security logs."
          );
        }

        setLogs(data.logs || []);
      } catch (error) {
        console.error(
          "Failed to load security logs:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load security logs."
        );
      } finally {
        setLoading(false);
      }
    }

    loadSecurityLogs();
  }, []);

  if (loading) {
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
        <PanelHeader title={`${logs.length} events`} />

        {logs.length === 0 && !error ? (
          <div className="p-5 text-sm text-[#617582]">
            No security events were found.
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
                      {log.event_type}
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
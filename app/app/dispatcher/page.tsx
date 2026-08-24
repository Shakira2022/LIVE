"use client";

import Link from "next/link";
import {
  Ambulance,
  ArrowRight,
  CircleAlert,
  Radio,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LiveResponseMap } from "@/components/maps/live-response-map";
import { RequestListItem } from "@/components/requests/request-list-item";
import { Metric } from "@/components/dashboard/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

import { supabase } from "@/lib/supabase";
import { isActiveStatus } from "@/lib/utils";

export default function DispatcherDashboard() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadRequests() {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from("emergency_requests")
          .select("*")
          .order("created_at", {
            ascending: false,
          });

        if (error) {
          console.error(
            "Failed to load emergency requests:",
            error
          );

          setRequests([]);
          return;
        }

        setRequests(data ?? []);
      } catch (error) {
        console.error(
          "Unexpected emergency request loading error:",
          error
        );

        setRequests([]);
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  const active = useMemo(() => {
    return requests.filter((request) => {
      if (
        request.is_active !== null &&
        request.is_active !== undefined
      ) {
        return request.is_active;
      }

      return isActiveStatus(
        request.current_status ?? ""
      );
    });
  }, [requests]);

  const unassigned = useMemo(() => {
    return active.filter(
      (request) =>
        request.current_status === "Submitted" ||
        request.current_status === "Received"
    );
  }, [active]);

  const critical = useMemo(() => {
    return active.filter(
      (request) =>
        request.severity === "Critical"
    );
  }, [active]);

  if (loading) {
    return <PageSkeleton map />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Dispatch operations"
        title="Live response overview"
        description="Monitor emergency requests, locations and response resources."
        action={
          <Badge tone="success">
            <span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]" />
            Operations online
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Active requests"
          value={active.length}
          detail="Across all operational states"
          tone="danger"
          icon={<Radio className="h-5 w-5" />}
        />

        <Metric
          label="Awaiting assignment"
          value={unassigned.length}
          detail="Requires dispatcher attention"
          tone="warning"
          icon={<CircleAlert className="h-5 w-5" />}
        />

        <Metric
          label="Available responders"
          value={0}
          detail="Responder data managed separately"
          tone="success"
          icon={<Users className="h-5 w-5" />}
        />

        <Metric
          label="Critical priority"
          value={critical.length}
          detail="Highest priority cases"
          tone="danger"
          icon={<Ambulance className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <LiveResponseMap
          showAll
          requests={[]}
          immersive
        />

        <Panel>
          <PanelHeader
            title="Priority queue"
            description="Newest active requests"
            action={
              <Link href="/app/dispatcher/requests">
                <Button
                  variant="ghost"
                  size="sm"
                >
                  All requests
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            }
          />

          {active.slice(0, 5).map((request) => (
            <RequestListItem
              key={request.id}
              request={request}
              href={`/app/dispatcher/requests/${request.id}`}
              compact
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}

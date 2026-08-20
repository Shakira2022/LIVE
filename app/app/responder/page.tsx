"use client";

import {
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requestStatusTone } from "@/lib/utils";

type Mission = {
  assignment: {
    id: string;
    request_id: string;
    responder_user_id: string;
    organisation_id: string;
    status:
      | "assigned"
      | "acknowledged"
      | "en_route"
      | "arrived"
      | "completed"
      | "cancelled"
      | "rejected";
    eta_minutes: number | null;
    assignment_note: string | null;
    assigned_at: string | null;
    acknowledged_at: string | null;
    route_started_at: string | null;
    arrived_at: string | null;
    completed_at: string | null;
  };

  request: any;

  location: any;

  statusHistory: any[];

  responder: {
    user_id: string;
    availability: string;
  } | null;
};

export default function ResponderMission() {
  const { user, loading: authLoading } = useAuth();

  const [mission, setMission] =
    useState<Mission | null>(null);

  const [loading, setLoading] = useState(true);

  const [updating, setUpdating] = useState(false);

  const [error, setError] = useState<string | null>(
    null
  );

  // ============================================================
  // LOAD CURRENT RESPONDER MISSION
  // ============================================================

  const loadMission = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log(
        "=========================================="
      );

      console.log("RESPONDER MISSION");

      console.log("LOGGED IN USER:", user.id);

      console.log(
        "=========================================="
      );

      const response = await fetch(
        "/api/responder/mission",
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result = await response.json();

      console.log(
        "RESPONDER MISSION RESPONSE:",
        result
      );

      if (!response.ok) {
        setError(
          result?.message ||
            "Unable to load responder mission."
        );

        setMission(null);

        return;
      }

      setMission(result.mission || null);
    } catch (err) {
      console.error(
        "Responder mission loading error:",
        err
      );

      setError(
        "Could not connect to the responder service."
      );

      setMission(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!authLoading && user?.id) {
      loadMission();
    }
  }, [authLoading, user?.id, loadMission]);

  // ============================================================
  // UPDATE RESPONDER MISSION
  // ============================================================

  async function updateMissionStatus(
    status:
      | "acknowledged"
      | "en_route"
      | "arrived"
      | "completed"
  ) {
    if (!mission?.assignment?.id) {
      alert("No active assignment was found.");

      return;
    }

    try {
      setUpdating(true);

      console.log(
        "=========================================="
      );

      console.log(
        "RESPONDER STATUS UPDATE"
      );

      console.log(
        "ASSIGNMENT:",
        mission.assignment.id
      );

      console.log(
        "NEW STATUS:",
        status
      );

      console.log(
        "=========================================="
      );

      const response = await fetch(
        "/api/responder/mission",
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            assignment_id:
              mission.assignment.id,

            status,
          }),
        }
      );

      const result = await response.json();

      console.log(
        "RESPONDER STATUS RESPONSE:",
        result
      );

      if (!response.ok) {
        alert(
          result?.message ||
            "Failed to update mission status."
        );

        return;
      }

      // Reload from Supabase so the responder page
      // always displays the actual database state.
      await loadMission();

      alert(
        status === "acknowledged"
          ? "Assignment acknowledged."
          : status === "en_route"
            ? "Route started."
            : status === "arrived"
              ? "Arrival recorded."
              : "Response completed."
      );
    } catch (err) {
      console.error(
        "Responder status update error:",
        err
      );

      alert(
        "Could not connect to the responder service."
      );
    } finally {
      setUpdating(false);
    }
  }

  // ============================================================
  // LOADING
  // ============================================================

  if (
    authLoading ||
    loading ||
    !user
  ) {
    return <PageSkeleton map />;
  }

  // ============================================================
  // ERROR
  // ============================================================

  if (error) {
    return (
      <div className="app-page">
        <Panel className="p-8">
          <div className="text-center">
            <h2 className="text-xl font-bold">
              Unable to load responder mission
            </h2>

            <p className="mt-2 text-sm text-[#627683]">
              {error}
            </p>

            <Button
              className="mt-5"
              onClick={loadMission}
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  // ============================================================
  // NO ACTIVE MISSION
  // ============================================================

  if (!mission) {
    return (
      <div className="app-page grid gap-5">
        <PageHeading
          eyebrow="Responder"
          title="Ready for assignment"
          description="No active emergency request is currently assigned to you."
          action={
            <Badge tone="success">
              Available
            </Badge>
          }
        />

        <Panel>
          <EmptyState
            icon={
              <Navigation className="h-7 w-7" />
            }
            title="No active mission"
            description="When a dispatcher assigns an emergency request to you, it will appear here automatically."
            action={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={loadMission}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>

                <Link href="/app/responder/history">
                  <Button variant="outline">
                    View assignment history
                  </Button>
                </Link>
              </div>
            }
          />
        </Panel>
      </div>
    );
  }

  // ============================================================
  // CURRENT MISSION
  // ============================================================

  const { assignment, request, location } =
    mission;

  const currentStatus =
    assignment.status;

  const requestStatus =
    request?.current_status ||
    "assigned";

  // ============================================================
  // ACTION BUTTON
  // ============================================================

  function action() {
    if (updating) {
      return (
        <Button
          size="lg"
          className="w-full"
          disabled
        >
          Updating...
        </Button>
      );
    }

    if (
      currentStatus === "assigned"
    ) {
      return (
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            updateMissionStatus(
              "acknowledged"
            )
          }
        >
          <CheckCircle2 className="h-5 w-5" />

          Acknowledge assignment
        </Button>
      );
    }

    if (
      currentStatus ===
      "acknowledged"
    ) {
      return (
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            updateMissionStatus(
              "en_route"
            )
          }
        >
          <Navigation className="h-5 w-5" />

          Start route
        </Button>
      );
    }

    if (
      currentStatus ===
      "en_route"
    ) {
      return (
        <Button
          size="lg"
          variant="warning"
          className="w-full"
          onClick={() =>
            updateMissionStatus(
              "arrived"
            )
          }
        >
          <MapPin className="h-5 w-5" />

          Mark arrived
        </Button>
      );
    }

    if (
      currentStatus === "arrived"
    ) {
      return (
        <Button
          size="lg"
          variant="success"
          className="w-full"
          onClick={() =>
            updateMissionStatus(
              "completed"
            )
          }
        >
          <CheckCircle2 className="h-5 w-5" />

          Complete response
        </Button>
      );
    }

    return null;
  }

  // ============================================================
  // PAGE
  // ============================================================

  return (
    <div className="app-page grid gap-5">

      <PageHeading
        eyebrow="Responder"
        title="Active mission"
        description={`${request?.reference_code || request?.id} · ${
          request?.category || "Emergency"
        }`}
        action={
          <Badge
            tone={requestStatusTone(
              requestStatus
            )}
            className="min-h-9 px-4"
          >
            {requestStatus}
          </Badge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">

        {/* ======================================================
            MAP
        ====================================================== */}

        <LiveResponseMap
          request={{
            ...request,

            location: {
              address:
                location?.address_text ||
                location?.landmark ||
                "Location not available",

              latitude:
                location?.latitude ?? 0,

              longitude:
                location?.longitude ?? 0,
            },
          }}
          immersive
          mobileAction={action()}
        />

        {/* ======================================================
            DESKTOP ACTIONS
        ====================================================== */}

        <div className="hidden content-start gap-4 xl:grid">

          <Panel>
            <PanelHeader
              title="Mission action"
              description="Update the mission only after the operational step has occurred."
            />

            <div className="p-4">
              {action()}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Requester and incident"
            />

            <div className="divide-y divide-[#e2e8ed]">

              <div className="flex gap-3 p-4">
                <PhoneCall className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <p className="font-semibold">
                    {request?.requester_id ||
                      "Unknown requester"}
                  </p>

                  <p className="mt-1 text-sm text-[#627683]">
                    {request?.callback_number ||
                      "No callback number"}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4">
                <Clock3 className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <p className="font-semibold">
                    Estimated arrival
                  </p>

                  <p className="mt-1 text-sm text-[#627683]">
                    {assignment?.eta_minutes !==
                    null &&
                    assignment?.eta_minutes !==
                    undefined
                      ? `${assignment.eta_minutes} minutes`
                      : "Not available"}
                  </p>
                </div>
              </div>

              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                  Incident note
                </p>

                <p className="mt-2 text-sm leading-6 text-[#526978]">
                  {request?.note ||
                    assignment?.assignment_note ||
                    "No incident note."}
                </p>
              </div>

              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                  Location
                </p>

                <p className="mt-2 text-sm leading-6 text-[#526978]">
                  {location?.address_text ||
                    location?.landmark ||
                    "Location not available"}
                </p>
              </div>

            </div>
          </Panel>
        </div>

        {/* ======================================================
            TIMELINE
        ====================================================== */}

        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Mission timeline"
          />

          <StatusTimeline
            entries={
              mission.statusHistory || []
            }
          />
        </Panel>

      </div>
    </div>
  );
}
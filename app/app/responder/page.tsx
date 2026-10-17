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
import { useCallback, useEffect, useRef, useState } from "react";

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
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { requestStatusTone } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Mission = {
  assignment: {
    id: string;
    request_id: string;
    responder_user_id: string;
    responderUserId?: string;
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
    current_latitude: number | null;
    current_longitude: number | null;
  } | null;
};

type MissionResponse = {
  ok?: boolean;
  data?: {
    mission?: Mission | null;
    queuedRequests?: any[];
    message?: string;
    assignment?: Mission["assignment"];
    requestStatus?: string;
    request_status?: string;
  };
  mission?: Mission | null;
  queuedRequests?: any[];
  assignment?: Mission["assignment"];
  message?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

type MissionCache = {
  mission: Mission | null;
  queuedRequests: any[];
};

const ARRIVAL_THRESHOLD_METRES = 100;

function distanceMetresBetween(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
) {
  const earthRadiusMetres = 6_371_000;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const latitudeDelta = toRadians(secondLatitude - firstLatitude);
  const longitudeDelta = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMetres * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getApiMessage(
  result: MissionResponse | null,
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

  return (
    result.message ||
    fallback
  );
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

  const refreshResponse = await fetch(
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

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function ResponderMission() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const missionCacheKey = user?.id ? `responder-mission:${user.id}` : "";
  const initialMissionCache = user?.id
    ? readCached<MissionCache>(missionCacheKey)
    : null;

  const [mission, setMission] =
    useState<Mission | null>(() => initialMissionCache?.mission ?? null);

  const [queuedRequests, setQueuedRequests] = useState<any[]>(
    () => initialMissionCache?.queuedRequests ?? [],
  );

  const [loading, setLoading] = useState(!initialMissionCache);

  const [updating, setUpdating] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  const [autoArriving, setAutoArriving] = useState(false);
  const autoArrivalScheduled = useRef(false);

  /* ------------------------------------------------------------------------ */
  /* Load current responder mission                                           */
  /* ------------------------------------------------------------------------ */

  const loadMission = useCallback(async (showLoading = true) => {
    if (!user?.id) {
      setMission(null);
      setLoading(false);
      return;
    }

    try {
      if (showLoading) setLoading(true);
      setError(null);

      const response =
        await authenticatedFetch(
          "/api/responder/mission",
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const result =
        await readJson<MissionResponse>(
          response,
        );

      if (!response.ok) {
        if (response.status === 401) {
          /*
           * Refresh failed too. Synchronise AuthProvider with the server.
           */
          await refresh();
        }

        setError(
          getApiMessage(
            result,
            "Unable to load responder mission.",
          ),
        );

        return;
      }

      /*
       * New middleware route:
       * { ok: true, data: { mission } }
       *
       * Old route fallback:
       * { ok: true, mission }
       */
      const nextMission =
        result?.data?.mission ??
        result?.mission ??
        null;

      const nextQueuedRequests =
        result?.data?.queuedRequests ??
        result?.queuedRequests ??
        [];

      setMission(
        nextMission,
      );
      setQueuedRequests(nextQueuedRequests);
      if (missionCacheKey) {
        writeFreshCache(
          missionCacheKey,
          { mission: nextMission, queuedRequests: nextQueuedRequests },
          nextMission ? 5 * 60_000 : 30_000,
        );
      }
    } catch (err) {
      console.warn(
        "Responder mission loading error:",
        err instanceof Error
          ? err.message
          : String(err),
      );

      setError(
        "Could not connect to the responder service.",
      );

      // Keep the last server response visible while offline. The next
      // successful poll replaces it with the current database state.
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [
    missionCacheKey,
    refresh,
    user?.id,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Load mission when authentication is ready                                */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!authLoading && user?.id) {
      const cached = readCached<MissionCache>(`responder-mission:${user.id}`);
      if (cached) {
        setMission(cached.mission);
        setQueuedRequests(cached.queuedRequests);
        setLoading(false);
      }

      void loadMission(!cached);

      const refreshTimer = window.setInterval(() => {
        void loadMission(false);
      }, 3_000);

      return () => window.clearInterval(refreshTimer);
    }

    if (!authLoading && !user) {
      setMission(null);
      setLoading(false);
    }

    return undefined;
  }, [
    authLoading,
    user?.id,
    loadMission,
    user,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Update responder mission status                                           */
  /* ------------------------------------------------------------------------ */

  async function updateMissionStatus(
    status:
      | "acknowledged"
      | "en_route"
      | "arrived"
      | "completed",
  ) {
    if (!mission?.assignment?.id) {
      alert("No active assignment was found.");
      return;
    }

    try {
      setUpdating(true);

      console.log(
        "==========================================",
      );

      console.log(
        "RESPONDER STATUS UPDATE",
      );

      console.log(
        "ASSIGNMENT:",
        mission.assignment.id,
      );

      console.log(
        "NEW STATUS:",
        status,
      );

      console.log(
        "==========================================",
      );

      const response =
        await authenticatedFetch(
          "/api/responder/mission",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              assignment_id:
                mission.assignment.id,
              status,
            }),
          },
        );

      const result =
        await readJson<MissionResponse>(
          response,
        );

      if (!response.ok) {
        if (response.status === 401) {
          await refresh();
        }

        alert(
          getApiMessage(
            result,
            "Failed to update mission status.",
          ),
        );

        return;
      }

      /* Acknowledging an assignment immediately starts the route. */
      if (status === "acknowledged") {
        await loadMission();
        await updateMissionStatus("en_route");
        return;
      }

      /* ------------------------------------------------------------------ */
      /* IMPORTANT: Completed missions must disappear from the active page. */
      /* ------------------------------------------------------------------ */

      if (status === "completed") {
        console.log(
          "MISSION COMPLETED - REMOVING FROM ACTIVE MISSION SCREEN",
        );

        /*
         * The mission is already completed in Supabase.
         *
         * We intentionally DO NOT call loadMission() here.
         *
         * This prevents the completed mission from briefly disappearing
         * and then appearing again on the responder screen.
         *
         * The assignment remains in the database and can still be viewed
         * in responder history.
         */
        setMission(null);
        setError(null);

        alert(
          "Response completed. You are now available for a new assignment.",
        );

        return;
      }

      /* ------------------------------------------------------------------ */
      /* Reload for normal status changes.                                  */
      /* ------------------------------------------------------------------ */

      await loadMission();

      alert(
        status === "en_route"
          ? "Route started."
          : "Arrival recorded.",
      );
    } catch (err) {
      console.warn(
        "Responder status update error:",
        err instanceof Error
          ? err.message
          : String(err),
      );

      alert(
        "Could not connect to the responder service.",
      );
    } finally {
      setUpdating(false);
      setAutoArriving(false);
    }
  }

  useEffect(() => {
    const activeMission = mission;

    if (!activeMission || activeMission.assignment.status !== "en_route") {
      autoArrivalScheduled.current = false;
      setAutoArriving(false);
      return;
    }

    const requestLatitude = Number(activeMission.location?.latitude);
    const requestLongitude = Number(activeMission.location?.longitude);
    const responderLatitude = Number(activeMission.responder?.current_latitude);
    const responderLongitude = Number(activeMission.responder?.current_longitude);

    if (
      !Number.isFinite(requestLatitude) ||
      !Number.isFinite(requestLongitude) ||
      !Number.isFinite(responderLatitude) ||
      !Number.isFinite(responderLongitude)
    ) {
      return;
    }

    const distanceMetres = distanceMetresBetween(
      responderLatitude,
      responderLongitude,
      requestLatitude,
      requestLongitude,
    );

    if (
      distanceMetres > ARRIVAL_THRESHOLD_METRES ||
      autoArrivalScheduled.current
    ) {
      return;
    }

    autoArrivalScheduled.current = true;
    setAutoArriving(true);
    const timer = window.setTimeout(() => {
      void updateMissionStatus("arrived");
    }, 3_000);

    return () => window.clearTimeout(timer);
  }, [
    mission?.assignment.id,
    mission?.assignment.status,
    mission?.location?.latitude,
    mission?.location?.longitude,
    mission?.responder?.current_latitude,
    mission?.responder?.current_longitude,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Loading                                                                   */
  /* ------------------------------------------------------------------------ */

  if (
    authLoading ||
    (loading && !initialMissionCache) ||
    !user
  ) {
    return <PageSkeleton map />;
  }

  /* ------------------------------------------------------------------------ */
  /* Error                                                                     */
  /* ------------------------------------------------------------------------ */

  if (error && !mission && queuedRequests.length === 0) {
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
              onClick={() => void loadMission()}
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* No active mission                                                         */
  /* ------------------------------------------------------------------------ */

  if (!mission) {
    return (
      <div className="w-full pb-24">
        <LiveResponseMap
          requests={queuedRequests}
          showAll={queuedRequests.length > 0}
          hideMapStatus
          responderMode
          emptyMapMessage={
            queuedRequests.length > 0
              ? "Emergency requests available - go online to be assigned"
              : "No queued emergency requests"
          }
          className="h-[calc(100dvh-9rem)] min-h-[430px] w-full rounded-none md:h-[calc(100dvh-4rem)] md:min-h-[560px] md:rounded-none"
        />
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Current mission                                                           */
  /* ------------------------------------------------------------------------ */

  const {
    assignment,
    request,
    location,
  } = mission;

  const currentStatus =
    assignment?.status;

  const requestStatus =
    request?.current_status ||
    currentStatus ||
    "assigned";

  const requestLatitude = Number(location?.latitude);
  const requestLongitude = Number(location?.longitude);
  const responderLatitude = Number(mission.responder?.current_latitude);
  const responderLongitude = Number(mission.responder?.current_longitude);
  const distanceToSceneMetres =
    Number.isFinite(requestLatitude) &&
    Number.isFinite(requestLongitude) &&
    Number.isFinite(responderLatitude) &&
    Number.isFinite(responderLongitude)
      ? distanceMetresBetween(
          responderLatitude,
          responderLongitude,
          requestLatitude,
          requestLongitude,
        )
      : null;
  const arrivedReady =
    currentStatus === "en_route" &&
    distanceToSceneMetres !== null &&
    distanceToSceneMetres <= ARRIVAL_THRESHOLD_METRES;

  /* ------------------------------------------------------------------------ */
  /* Action button                                                             */
  /* ------------------------------------------------------------------------ */

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
            void updateMissionStatus(
              "acknowledged",
            )
          }
        >
          <CheckCircle2 className="h-5 w-5" />
          Acknowledge assignment
        </Button>
      );
    }

    if (
      currentStatus === "acknowledged"
    ) {
      return (
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            void updateMissionStatus(
              "en_route",
            )
          }
        >
          <Navigation className="h-5 w-5" />
          Start route
        </Button>
      );
    }

    if (
      currentStatus === "en_route"
    ) {
      return (
        <Button
          size="lg"
          variant="warning"
          className="w-full"
          disabled={!arrivedReady || autoArriving}
          onClick={() =>
            void updateMissionStatus(
              "arrived",
            )
          }
        >
          <MapPin className="h-5 w-5" />
          {autoArriving
            ? "Marking arrived..."
            : arrivedReady
              ? "Mark arrived"
              : `Arrived within ${ARRIVAL_THRESHOLD_METRES} m`}
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
            void updateMissionStatus(
              "completed",
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

  /* ------------------------------------------------------------------------ */
  /* Location data                                                             */
  /* ------------------------------------------------------------------------ */

  const locationAddress =
    location?.address_text ||
    location?.landmark ||
    "Location not available";

  const locationLatitude =
    location?.latitude ?? 0;

  const locationLongitude =
    location?.longitude ?? 0;

  const mapRequest = {
    ...request,
    location: {
      address: locationAddress,
      lat: locationLatitude,
      lng: locationLongitude,
      latitude: locationLatitude,
      longitude: locationLongitude,
    },
  };

  const responderLocation =
    mission.responder?.current_latitude != null &&
    mission.responder?.current_longitude != null
      ? {
          lat: Number(mission.responder.current_latitude),
          lng: Number(mission.responder.current_longitude),
        }
      : undefined;

  const mapResponder = responderLocation
    ? { location: responderLocation, name: "You" }
    : undefined;

  /* ------------------------------------------------------------------------ */
  /* Page                                                                      */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="w-full pb-24 md:mx-auto md:max-w-[1480px] md:px-8 md:py-8">
      {false && <PageHeading
        eyebrow="Responder"
        title="Active mission"
        description={`${request?.reference_code || request?.id || "Emergency"} · ${
          request?.category || "Emergency"
        }`}
        action={
          <Badge
            tone={requestStatusTone(
              requestStatus,
            )}
            className="min-h-9 px-4"
          >
            {requestStatus}
          </Badge>
        }
      />}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        {/* ---------------------------------------------------------------- */}
        {/* Map                                                               */}
        {/* ---------------------------------------------------------------- */}

        <LiveResponseMap
          request={mapRequest}
          requests={[]}
          showAll={false}
          responder={mapResponder}
          responderAssigned={Boolean(assignment?.responder_user_id || assignment?.responderUserId)}
          responderMode
          requesterName={request?.requester_name || request?.requesterName || "Requester"}
          immersive
          hideMapStatus
          className="h-[calc(100dvh-9rem)] min-h-[430px] w-full rounded-none md:h-[62dvh] md:min-h-[480px] md:rounded-[22px]"
          mobileAction={action()}
        />

        {/* ---------------------------------------------------------------- */}
        {/* Desktop actions                                                   */}
        {/* ---------------------------------------------------------------- */}

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
              {/* Requester */}
              <div className="flex gap-3 p-4">
                <PhoneCall className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <p className="font-semibold">
                    {request?.requester_name ||
                      request?.requesterName ||
                      "Unknown requester"}
                  </p>

                  <p className="mt-1 text-sm text-[#627683]">
                    {request?.callback_number ||
                      request?.callbackNumber ||
                      "No callback number"}
                  </p>
                </div>
              </div>

              {/* ETA */}
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

              {/* Incident note */}
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

              {/* Location */}
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                  Location
                </p>

                <p className="mt-2 text-sm leading-6 text-[#526978]">
                  {locationAddress}
                </p>
              </div>
            </div>
          </Panel>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Mission timeline                                                  */}
        {/* ---------------------------------------------------------------- */}

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

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
import { useCall, useCallRoom } from "@/components/calls/call-provider";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { requestStatusTone } from "@/lib/utils";
import { readResponderPreferences } from "@/lib/responder-preferences";

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
    go_offline_after_mission?: boolean;
    current_latitude: number | null;
    current_longitude: number | null;
  } | null;
};

type MissionResponse = {
  ok?: boolean;
  data?: {
    mission?: Mission | null;
    queuedRequests?: any[];
    responder?: Mission["responder"];
    mapCenter?: { lat: number; lng: number } | null;
    responderAvailability?: string | null;
    message?: string;
    assignment?: Mission["assignment"];
    requestStatus?: string;
    request_status?: string;
  };
  mission?: Mission | null;
  queuedRequests?: any[];
  responder?: Mission["responder"];
  mapCenter?: { lat: number; lng: number } | null;
  responderAvailability?: string | null;
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
  responderAvailability?: string;
  responderLocation?: { lat: number; lng: number } | null;
  mapCenter?: { lat: number; lng: number } | null;
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

  const missionCacheKey = user?.id
    ? `responder-mission-v4:${user.id}:${user.organisationId ?? "unassigned"}`
    : "";
  const initialMissionCache = user?.id
    ? readCached<MissionCache>(missionCacheKey)
    : null;

  const [mission, setMission] =
    useState<Mission | null>(() => initialMissionCache?.mission ?? null);

  const [queuedRequests, setQueuedRequests] = useState<any[]>(
    () => initialMissionCache?.queuedRequests ?? [],
  );
  const [responderAvailability, setResponderAvailability] = useState(
    () => initialMissionCache?.responderAvailability ?? "offline",
  );
  const [cachedResponderLocation, setCachedResponderLocation] = useState<MissionCache["responderLocation"]>(
    () => initialMissionCache?.responderLocation ?? null,
  );
  const [mapFallbackCenter, setMapFallbackCenter] = useState<MissionCache["mapCenter"]>(
    () => initialMissionCache?.mapCenter ?? null,
  );

  const [loading, setLoading] = useState(!initialMissionCache);

  const [updating, setUpdating] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );
  const [missionNotice, setMissionNotice] = useState("");
  const missionNoticeTimer = useRef<number | null>(null);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(false);
  const lastSpokenMissionState = useRef("");
  const lastSpokenOfflineQueue = useRef("");

  const [autoArriving, setAutoArriving] = useState(false);
  const autoArrivalScheduled = useRef(false);
  const { startCall, call } = useCall();
  useCallRoom(mission?.assignment.request_id);

  function showMissionNotice(message: string) {
    setMissionNotice(message);
    if (missionNoticeTimer.current !== null) window.clearTimeout(missionNoticeTimer.current);
    missionNoticeTimer.current = window.setTimeout(() => {
      setMissionNotice("");
      missionNoticeTimer.current = null;
    }, 3500);
  }

  useEffect(() => () => {
    if (missionNoticeTimer.current !== null) window.clearTimeout(missionNoticeTimer.current);
  }, []);

  useEffect(() => {
    if (!user?.id) { setVoiceGuidanceEnabled(false); return; }
    const sync = () => setVoiceGuidanceEnabled(readResponderPreferences(user.id).voiceGuidance);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("live:responder-preferences-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:responder-preferences-changed", sync);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!voiceGuidanceEnabled || !("speechSynthesis" in window)) return;
    if (mission?.assignment?.id) {
      const status = String(mission.assignment.status ?? "assigned").toLowerCase();
      const key = `${mission.assignment.id}:${status}`;
      if (lastSpokenMissionState.current === key) return;
      lastSpokenMissionState.current = key;
      lastSpokenOfflineQueue.current = "";
      const requestCategory = mission.request?.category ?? "emergency";
      const priority = mission.request?.severity ?? mission.request?.priority;
      const description = mission.request?.description ?? mission.request?.note;
      const address = mission.location?.address_text ?? mission.location?.landmark ?? "Location unavailable";
      const text = status === "assigned"
        ? `You have been assigned a request. ${requestCategory}${priority ? `, ${priority} priority` : ""}.${description ? ` Details: ${description}.` : ""} Location: ${address}. Review the incident, then acknowledge the assignment if you can respond.`
        : status === "acknowledged"
          ? `Assignment acknowledged. Start the route when you begin travelling to the incident.`
          : status === "en_route"
            ? `You are en route to ${address}. Mark arrived when you reach the location.`
            : status === "arrived"
              ? `You are marked as arrived. Complete the response when the work is finished.`
              : "Your mission status has changed.";
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-ZA";
      utterance.rate = 0.94;
      window.speechSynthesis.speak(utterance);
      return;
    }

    lastSpokenMissionState.current = "";
    const queueKey = `${responderAvailability}:${queuedRequests.length}`;
    if (queuedRequests.length > 0 && responderAvailability !== "available" && lastSpokenOfflineQueue.current !== queueKey) {
      lastSpokenOfflineQueue.current = queueKey;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("Emergency requests are waiting. You are offline. Go online to become eligible for an assignment.");
      utterance.lang = "en-ZA";
      utterance.rate = 0.94;
      window.speechSynthesis.speak(utterance);
    } else if (queuedRequests.length === 0) {
      lastSpokenOfflineQueue.current = "";
    }
  }, [mission, queuedRequests.length, responderAvailability, voiceGuidanceEnabled]);

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
      const nextResponderAvailability =
        result?.data?.responder?.availability ??
        result?.responder?.availability ??
        nextMission?.responder?.availability ??
        "offline";
      const responseResponder = result?.data?.responder ?? result?.responder ?? nextMission?.responder;
      const nextMapCenter = result?.data?.mapCenter ?? result?.mapCenter ?? null;
      const responderLatitude = Number(responseResponder?.current_latitude);
      const responderLongitude = Number(responseResponder?.current_longitude);
      const nextResponderLocation = responseResponder?.current_latitude != null &&
        responseResponder?.current_longitude != null &&
        Number.isFinite(responderLatitude) &&
        Number.isFinite(responderLongitude) &&
        !(responderLatitude === 0 && responderLongitude === 0)
        ? { lat: responderLatitude, lng: responderLongitude }
        : null;

      setMission(
        nextMission,
      );
      setQueuedRequests(nextQueuedRequests);
      setResponderAvailability(nextResponderAvailability);
      setCachedResponderLocation(nextResponderLocation);
      setMapFallbackCenter(nextMapCenter);
      if (missionCacheKey) {
        writeFreshCache(
          missionCacheKey,
          {
            mission: nextMission,
            queuedRequests: nextQueuedRequests,
            responderAvailability: nextResponderAvailability,
            responderLocation: nextResponderLocation,
            mapCenter: nextMapCenter,
          },
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
      // Reuse this user's recent mission snapshot on page switches, then refresh
      // it from the database. A cold cache waits for the first fresh response so
      // a default-city map cannot flash before the request pin is known.
      const cached = readCached<MissionCache>(missionCacheKey);
      if (cached) {
        setMission(cached.mission);
        setQueuedRequests(cached.queuedRequests);
        setResponderAvailability(cached.responderAvailability ?? cached.mission?.responder?.availability ?? "offline");
        setCachedResponderLocation(cached.responderLocation ?? null);
        setMapFallbackCenter(cached.mapCenter ?? null);
        setLoading(false);
        void loadMission(false);
      } else {
        setMission(null);
        setQueuedRequests([]);
        setResponderAvailability("offline");
        setCachedResponderLocation(null);
        setMapFallbackCenter(null);
        setLoading(true);
        void loadMission(true);
      }

      const refreshTimer = window.setInterval(() => {
        // The mission endpoint also checks the queue for an available responder.
        void loadMission(false);
      }, 5_000);

      return () => window.clearInterval(refreshTimer);
    }

    if (!authLoading && !user) {
      setMission(null);
      setLoading(false);
    }

    return undefined;
  }, [
    authLoading,
    missionCacheKey,
    user?.id,
    loadMission,
  ]);

  const cacheResponderLocation = useCallback((location: { lat: number; lng: number }) => {
    setCachedResponderLocation(location);
    if (!missionCacheKey) return;

    const cached = readCached<MissionCache>(missionCacheKey);
    if (!cached) return;
    writeFreshCache(
      missionCacheKey,
      {
        ...cached,
        responderLocation: location,
      },
      cached.mission ? 5 * 60_000 : 30_000,
    );
  }, [missionCacheKey]);

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

      if (!result) {
        alert("The mission update response was empty. Please try again.");
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

        const completedAvailability = result.data?.responderAvailability
          ?? result.responderAvailability
          ?? mission.responder?.availability
          ?? "available";
        setResponderAvailability(completedAvailability);
        if (missionCacheKey) {
          const cached = readCached<MissionCache>(missionCacheKey);
          writeFreshCache(
            missionCacheKey,
            {
              mission: null,
              queuedRequests: cached?.queuedRequests ?? [],
              responderAvailability: completedAvailability,
              responderLocation: cached?.responderLocation ?? cachedResponderLocation,
              mapCenter: cached?.mapCenter ?? mapFallbackCenter,
            },
            5 * 60_000,
          );
        }

        showMissionNotice(
          completedAvailability === "offline"
            ? "Response completed. Status: offline."
            : "Response completed. You are available.",
        );

        return;
      }

      /* ------------------------------------------------------------------ */
      /* Reload for normal status changes.                                  */
      /* ------------------------------------------------------------------ */

      await loadMission();

      if (status === "en_route") showMissionNotice("Mission started");
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

  if (authLoading || !user) {
    return null;
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
        <div className="px-4 pb-4 pt-5 md:px-8 md:pt-8">
          <PageHeading
            title={`Hello, ${user.name}`}
            description="Your current mission and available emergency requests are shown below."
          />
        </div>
        {loading && queuedRequests.length === 0 ? (
          <Skeleton className="h-[calc(100dvh-9rem)] min-h-[430px] rounded-none md:h-[calc(100dvh-4rem)] md:min-h-[560px]" />
        ) : (
          <LiveResponseMap
            requests={queuedRequests}
            showAll={queuedRequests.length > 0}
            responder={cachedResponderLocation ? { location: cachedResponderLocation, name: user.name } : undefined}
            onResponderLocationChange={cacheResponderLocation}
            fallbackCenter={mapFallbackCenter}
            hideMapStatus
            responderMode
            emptyMapMessage={queuedRequests.length > 0
              ? responderAvailability === "available"
                ? "You are online and waiting for a mission assignment"
                : "Emergency requests available - go online to be assigned"
              : "No queued emergency requests"}
            className="h-[calc(100dvh-9rem)] min-h-[430px] w-full rounded-none md:h-[calc(100dvh-4rem)] md:min-h-[560px] md:rounded-none"
          />
        )}
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
              ? "Arrived"
              : "En route"}
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

  const locationLatitude = location?.latitude == null ? null : Number(location.latitude);
  const locationLongitude = location?.longitude == null ? null : Number(location.longitude);
  const hasRequestCoordinates = Number.isFinite(locationLatitude) &&
    Number.isFinite(locationLongitude) &&
    !(locationLatitude === 0 && locationLongitude === 0);

  const mapRequest = {
    ...request,
    location: hasRequestCoordinates ? {
      address: locationAddress,
      lat: locationLatitude,
      lng: locationLongitude,
      latitude: locationLatitude,
      longitude: locationLongitude,
    } : null,
  };

  const missionResponderLocation =
    mission.responder?.current_latitude != null &&
    mission.responder?.current_longitude != null
      ? {
          lat: Number(mission.responder.current_latitude),
          lng: Number(mission.responder.current_longitude),
        }
      : undefined;

  const responderMapLocation = cachedResponderLocation ?? missionResponderLocation;
  const mapResponder = responderMapLocation
    ? { location: responderMapLocation, name: user.name }
    : undefined;

  /* ------------------------------------------------------------------------ */
  /* Page                                                                      */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="flex h-[calc(100dvh-4rem-5rem)] flex-col overflow-hidden bg-transparent pt-0 md:grid md:h-auto md:min-h-[calc(100dvh-4rem)] md:grid-rows-[auto_auto] md:gap-5 md:overflow-visible md:px-8 md:pt-8 md:pb-8">
      {missionNotice ? <div className="fixed left-1/2 top-[4.75rem] z-[1100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#0f5b67] px-5 py-3 text-sm font-semibold text-white shadow-lg" role="status" aria-live="polite"><CheckCircle2 className="h-5 w-5" />{missionNotice}</div> : null}
      <div className="mb-0 px-5 py-3 sm:px-6 md:hidden">
        <PageHeading
          title={`Hello, ${user.name}`}
          description="Your current mission and route details are shown below."
          compact
        />
      </div>
      <div className="hidden md:block">
        <PageHeading
          title={`Hello, ${user.name}`}
          description="Your current mission and route details are shown below."
        />
      </div>
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

      <div className="relative z-10 min-h-0 flex-1 md:static md:z-auto md:grid md:h-auto md:min-h-[min(72dvh,800px)] md:flex-none md:grid-cols-[1.35fr_.65fr] md:gap-4">
        {/* ---------------------------------------------------------------- */}
        {/* Map                                                               */}
        {/* ---------------------------------------------------------------- */}

        <div className="h-full min-h-0 overflow-hidden md:min-h-0 md:overflow-hidden">
          <LiveResponseMap
            request={mapRequest}
            requests={[]}
            fallbackCenter={mapFallbackCenter}
            showAll={false}
            responder={mapResponder}
            onResponderLocationChange={cacheResponderLocation}
            responderAssigned={Boolean(assignment?.responder_user_id || assignment?.responderUserId)}
            responderMode
            requesterName={request?.requester_name || request?.requesterName || "Requester"}
            immersive
            mobileBottomOffset
            className="h-full min-h-0 w-full rounded-none md:h-full md:min-h-0 md:rounded-[22px]"
            mobileAction={
            <div className="grid gap-2">
              <div>{action()}</div>
              <div className="grid grid-cols-2 gap-2">
                <Link href={`/app/responder/track/${assignment.request_id}`} className="min-w-0">
                  <Button type="button" size="lg" variant="outline" className="w-full px-2 text-xs sm:text-sm">
                    Open tracking
                  </Button>
                </Link>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="w-full px-2 text-xs sm:text-sm"
                  disabled={!mission?.assignment.request_id || call.status !== "idle"}
                  onClick={() => void startCall(
                    mission!.assignment.request_id,
                    request?.requester_name || request?.requesterName || "Requester",
                    { targetRole: "requester" },
                  )}
                >
                  <PhoneCall className="h-5 w-5" />
                  Call requester
                </Button>
              </div>
            </div>
            }
          />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Desktop actions                                                   */}
        {/* ---------------------------------------------------------------- */}

        <div className="hidden content-start gap-4 md:grid">
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

                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {request?.requester_name ||
                      request?.requesterName ||
                      "Unknown requester"}
                  </p>

                  <div className="mt-3 flex items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      aria-label="Call requester"
                      className="w-auto min-w-11 whitespace-nowrap px-2 text-xs"
                      disabled={!mission?.assignment.request_id || call.status !== "idle"}
                      onClick={() => void startCall(
                        mission!.assignment.request_id,
                        request?.requester_name || request?.requesterName || "Requester",
                        { targetRole: "requester" },
                      )}
                    >
                      <PhoneCall className="h-4 w-4" />
                      <span className="hidden lg:inline">Call requester</span>
                    </Button>
                    <Link href={`/app/responder/track/${assignment.request_id}`}>
                      <Button type="button" size="sm" variant="outline" className="w-auto whitespace-nowrap px-2 text-xs">
                        Open tracking
                      </Button>
                    </Link>
                  </div>
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

            </div>
          </Panel>
        </div>

      </div>
    </div>
  );
}

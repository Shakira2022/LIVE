"use client";

import Link from "next/link";
import {
  Ambulance,
  ArrowRight,
  CircleAlert,
  ExternalLink,
  Radio,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiveResponseMap } from "@/components/maps/live-response-map";
import { DispatcherCancellationInbox } from "@/components/dispatcher/cancellation-inbox";
import { RequestListItem } from "@/components/requests/request-list-item";
import { Metric } from "@/components/dashboard/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

import { effectiveRequestStatus, formatRequestStatus } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type DispatcherDashboardCache = {
  requests: any[];
  availableResponders: any[];
  availableResponderCount: number;
  operationalRoutes: any[];
  mapCenter: { lat: number; lng: number } | null;
};

type DispatcherResponderProfile = {
  user_id: string;
  availability: string;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  user: {
    id: string;
    first_name: string;
    last_name: string;
    display_name: string | null;
  } | null;
};

function responderKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const TERMINAL_REQUEST_STATUSES = new Set(["closed", "cancelled", "rejected"]);

function requestLifecycleStatus(request: any) {
  return String(request.current_status ?? request.currentStatus ?? request.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isOperationalRequest(request: any) {
  const activeFlag = request.isActive ?? request.is_active;
  const cancelledFlag = request.isCancelled ?? request.is_cancelled;
  return activeFlag !== false
    && String(activeFlag ?? "").toLowerCase() !== "false"
    && !TERMINAL_REQUEST_STATUSES.has(requestLifecycleStatus(request))
    && cancelledFlag !== true
    && String(cancelledFlag ?? "").toLowerCase() !== "true"
    && !request.cancelled_at
    && !request.cancelledAt;
}

function uniqueOperationalRoutes(routes: any[]) {
  const seenResponders = new Set<string>();
  return routes.filter((route) => {
    const key = responderKey(route?.responder?.id);
    if (!key) return true;
    if (seenResponders.has(key)) return false;
    seenResponders.add(key);
    return true;
  });
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response = await fetch(input, requestInit);
  if (response.status !== 401) return response;

  const refreshResponse = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });

  if (!refreshResponse.ok) return response;
  response = await fetch(input, requestInit);
  return response;
}

export default function DispatcherDashboard() {
  const { user } = useAuth();
  const cacheKey = user?.id ? `dispatcher-dashboard:v3:${user.id}:${user.organisationId ?? "unassigned"}` : "";
  // Scope the cache by organisation so the current dispatcher's cached map is
  // instant without showing another organisation's data after a transfer.
  const initialCache = cacheKey ? readCached<DispatcherDashboardCache>(cacheKey) : null;
  const hasInitialCache = Boolean(initialCache);
  const initialRoutes = uniqueOperationalRoutes(initialCache?.operationalRoutes ?? []);
  const initialAssignedResponderIds = new Set(initialRoutes.map((route) => responderKey(route?.responder?.id)).filter(Boolean));
  const [requests, setRequests] = useState<any[]>(() => initialCache?.requests ?? []);
  const [availableResponders, setAvailableResponders] = useState<any[]>(() =>
    (initialCache?.availableResponders ?? []).filter((responder) => !initialAssignedResponderIds.has(responderKey(responder?.id))),
  );
  const [availableResponderCount, setAvailableResponderCount] = useState(() => initialCache?.availableResponderCount ?? 0);
  const [operationalRoutes, setOperationalRoutes] = useState<any[]>(() => initialRoutes);
  const [mapCenter, setMapCenter] = useState<DispatcherDashboardCache["mapCenter"]>(
    () => initialCache?.mapCenter ?? null,
  );
  const [loading, setLoading] = useState(() => !initialCache);
  const [mapEmergencyType, setMapEmergencyType] = useState("all");
  const [mapEmergencyStatus, setMapEmergencyStatus] = useState("active");
  const [selectedMapRequestId, setSelectedMapRequestId] = useState<string | null>(null);
  const handleMapIncidentSelect = useCallback((request: any) => {
    setSelectedMapRequestId(request.id);
  }, []);
  const operationalLoadInFlight = useRef(false);

  const loadOperationalData = useCallback(async (showLoading = false) => {
    if (operationalLoadInFlight.current) return;
    operationalLoadInFlight.current = true;
    if (showLoading && !hasInitialCache) setLoading(true);

    try {
      const requestResponse = await authenticatedFetch("/api/requests?scope=all&limit=100", {
        cache: "no-store",
      });
      const requestPayload = await requestResponse.json();
      if (!requestResponse.ok || requestPayload?.ok === false) {
        throw new Error(
          requestPayload?.error?.message ?? requestPayload?.message ?? "Unable to load active requests.",
        );
      }

      const requestData = requestPayload?.data?.items ?? requestPayload?.items ?? [];
      const resourcesResponse = await authenticatedFetch("/api/dispatcher/resources", {
        cache: "no-store",
      });
      const resourcesPayload = await resourcesResponse.json();
      if (!resourcesResponse.ok || resourcesPayload?.ok === false) {
        throw new Error(
          resourcesPayload?.error?.message ??
            resourcesPayload?.message ??
            "Unable to load organisation responders.",
        );
      }
      const resources = resourcesPayload?.data ?? resourcesPayload;
      const responderData = (resources?.responders ?? []) as DispatcherResponderProfile[];
      const busyResponderIds = new Set((resources?.busyResponderIds ?? []).map(responderKey));
      const nextMapCenter = resources?.mapCenter ?? null;

      const enrichedRequests = (requestData ?? []).map((request: any) => {
        const location = request.location ?? request.requestLocation;
        return {
          ...request,
          current_status: request.currentStatus ?? request.current_status ?? request.status,
          is_active: request.isActive ?? request.is_active ?? true,
          location: location
            ? {
                lat: Number(location.lat ?? location.latitude),
                lng: Number(location.lng ?? location.longitude),
                address: location.address ?? location.addressText ?? "Emergency request location",
                accuracy: location.accuracy ?? location.accuracyMeters,
                capturedAt: location.capturedAt,
              }
            : undefined,
        };
      });

      const openRequests = enrichedRequests.filter(isOperationalRequest);

      // Use the dedicated assignment endpoint used by the original dispatcher
      // flow. It returns the current assignment and explicitly loads the
      // responder profile coordinates, so every active request keeps its own
      // assigned driver.
      const detailResults = await Promise.all(
        openRequests.map(async (request: any) => {
          const response = await authenticatedFetch(`/api/Emergency-request/${request.id}/assignments`, {
            cache: "no-store",
          });
          if (!response.ok) return null;
          const payload = await response.json();
          return payload?.assignment
            ? { requestId: request.id, assignment: payload.assignment }
            : null;
        }),
      );
      const assignmentData = detailResults.flatMap((detail: any) =>
        detail
          ? [{ ...detail.assignment, request_id: detail.requestId }]
          : [],
      );
      const activeAssignmentStatusByRequest = new Map<string, string>();
      assignmentData.forEach((assignment: any) => {
        const assignmentStatus = String(assignment.status ?? "").toLowerCase();
        const requestStatus = assignmentStatus === "acknowledged" ? "assigned" : assignmentStatus;
        if (requestStatus && !activeAssignmentStatusByRequest.has(assignment.request_id)) {
          activeAssignmentStatusByRequest.set(assignment.request_id, requestStatus);
        }
      });
      const dispatcherRequests = enrichedRequests.map((request: any) => {
        const assignmentStatus = activeAssignmentStatusByRequest.get(request.id);
        const effectiveStatus = effectiveRequestStatus(request.current_status, assignmentStatus);
        return effectiveStatus !== request.current_status
          ? { ...request, current_status: effectiveStatus }
          : request;
      });
      const queueRequests = enrichedRequests.map((request: any) => {
        const assignment = assignmentData.find((item: any) => item.request_id === request.id);
        return {
          ...request,
          emergency_request_status: request.current_status,
          assignment_status: assignment?.status ?? null,
          assignment_id: assignment?.id ?? null,
          responder_user_id: assignment?.responderUserId ?? assignment?.responder_user_id ?? null,
          assigned_at: assignment?.assignedAt ?? assignment?.assigned_at ?? null,
          assigned_by_user_id: assignment?.assignedByUserId ?? assignment?.assigned_by_user_id ?? null,
          current_status: effectiveRequestStatus(request.current_status, assignment?.status),
        };
      });

      // Keep the first profile result loaded above as the source of the
      // responder availability list and live fallback coordinates.
      const profiles = responderData ?? [];
      const activeAssignmentResponderIds = new Set<string>(
        (assignmentData ?? [])
          .map((assignment) => assignment.responderUserId ?? assignment.responder_user_id)
          .map(responderKey)
          .filter(Boolean),
      );
      const availableProfiles = profiles.filter((profile) =>
        String(profile.availability).toLowerCase() === "available"
        && !activeAssignmentResponderIds.has(responderKey(profile.user_id))
        && !busyResponderIds.has(responderKey(profile.user_id)),
      );
      setAvailableResponderCount(availableProfiles.length);
      const usersById = new Map(profiles.map((profile) => [profile.user_id, profile.user]));

      const latestAssignmentByRequest = new Map<string, any>();
      (assignmentData ?? [])
        .filter((assignment) => !["completed", "cancelled", "rejected"].includes(String(assignment.status ?? "").toLowerCase()))
        .forEach((assignment) => {
        if (!latestAssignmentByRequest.has(assignment.request_id)) {
          latestAssignmentByRequest.set(assignment.request_id, assignment);
        }
        });
      // Defensive UI guard for databases that have not yet applied the
      // one-active-assignment-per-responder migration. Never render the same
      // responder as the driver for two requests on the live map.
      const usedResponderIds = new Set<string>();
      const routes = openRequests.flatMap((request: any) => {
        const directAssignment = latestAssignmentByRequest.get(request.id);
        const assignment = directAssignment;
        const responderId = assignment?.responderUserId ?? assignment?.responder_user_id;
        const responderIdentity = responderKey(responderId);
        if (!request.id || !responderIdentity) return [];
        if (usedResponderIds.has(responderIdentity)) return [];
        const responderProfile = profiles.find((profile) => profile.user_id === responderId);
        const latitude = Number(
          assignment?.responderLatitude ?? assignment?.responder?.current_latitude ?? responderProfile?.current_latitude,
        );
        const longitude = Number(
          assignment?.responderLongitude ?? assignment?.responder?.current_longitude ?? responderProfile?.current_longitude,
        );
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        usedResponderIds.add(responderIdentity);
        const user = usersById.get(responderId) ?? assignment?.responder?.user;
        return [{
          requestId: request.id,
          responder: {
            id: responderId,
            name: assignment?.responderName || user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Assigned responder",
            team: "Response team",
            vehicle: "Response vehicle",
            location: { lat: latitude, lng: longitude },
          },
        }];
      });

      const responders = availableProfiles.filter((responder) =>
        responder.current_latitude !== null && responder.current_longitude !== null
        && Number.isFinite(Number(responder.current_latitude))
        && Number.isFinite(Number(responder.current_longitude)),
      ).map((responder) => {
        const user = usersById.get(responder.user_id);
        return {
          id: responder.user_id,
          name: user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Available responder",
          team: "Response team",
          vehicle: "Ready for assignment",
          availability: "available",
          location: {
            lat: Number(responder.current_latitude),
            lng: Number(responder.current_longitude),
          },
        };
      });

      setRequests(dispatcherRequests);
      setAvailableResponders(responders);
      setOperationalRoutes(routes);
      setMapCenter(nextMapCenter);
      if (cacheKey) {
        writeFreshCache(cacheKey, {
          requests: dispatcherRequests,
          availableResponders: responders,
          availableResponderCount: availableProfiles.length,
          operationalRoutes: routes,
          mapCenter: nextMapCenter,
        }, 5 * 60_000);
        writeFreshCache(`dispatcher-requests:v3:${user?.id}:${user?.organisationId ?? "unassigned"}`, queueRequests, 5 * 60_000);
      }
    } catch (error) {
      console.error("Failed to load live operations data:", error);
      // Keep cached/last-known operations visible if a background refresh fails.
    } finally {
      if (showLoading) setLoading(false);
      operationalLoadInFlight.current = false;
    }
  }, [cacheKey, hasInitialCache, user?.id, user?.organisationId]);

  useEffect(() => {
    void loadOperationalData(!hasInitialCache);
    // Responder GPS updates are written continuously. Poll the dispatcher
    // view at 1 second so the live driver marker and route keep up instead of
    // waiting for the previous 3 second board refresh.
    const refreshTimer = window.setInterval(() => void loadOperationalData(), 1_000);
    return () => window.clearInterval(refreshTimer);
  }, [hasInitialCache, loadOperationalData]);

  const active = useMemo(() => {
    // An arrived emergency remains active, while cancellation timestamps and
    // flags are treated as terminal even if a stale status field says otherwise.
    return requests.filter(isOperationalRequest);
  }, [requests]);

  const activeRequestIds = useMemo(() => new Set(active.map((request) => request.id)), [active]);
  const activeOperationalRoutes = useMemo(
    () => operationalRoutes.filter((route) => activeRequestIds.has(route.requestId)),
    [operationalRoutes, activeRequestIds],
  );

  const latestActive = useMemo(() => [...active].sort((first, second) => {
    const firstDate = Date.parse(first.submittedAt ?? first.submitted_at ?? first.createdAt ?? first.created_at ?? "") || 0;
    const secondDate = Date.parse(second.submittedAt ?? second.submitted_at ?? second.createdAt ?? second.created_at ?? "") || 0;
    return secondDate - firstDate;
  }), [active]);

  const unassigned = useMemo(() => {
    return active.filter(
      (request) => ["submitted", "received"].includes(
        String(request.current_status ?? "").toLowerCase(),
      )
    );
  }, [active]);

  const critical = useMemo(() => {
    return active.filter(
      (request) => String(request.severity ?? "").toLowerCase() === "critical"
    );
  }, [active]);

  const mapEmergencyTypes = useMemo(() => {
    return Array.from(new Set(requests.map((request) => String(request.category ?? "").trim()).filter(Boolean)))
      .sort((first, second) => first.localeCompare(second));
  }, [requests]);

  const mapEmergencyStatuses = useMemo(() => {
    return Array.from(new Set(active.map((request) => String(
      request.current_status ?? request.currentStatus ?? request.status ?? "submitted",
    ).toLowerCase()).filter(Boolean)))
      .sort((first, second) => first.localeCompare(second));
  }, [active]);

  const filteredMapRequests = useMemo(() => {
    const statusFilteredRequests = mapEmergencyStatus === "active"
      ? active
      : active.filter((request) => String(
          request.current_status ?? request.currentStatus ?? request.status ?? "submitted",
        ).toLowerCase() === mapEmergencyStatus);

    return statusFilteredRequests.filter((request) => {
      const category = String(request.category ?? "").trim();
      return mapEmergencyType === "all" || category === mapEmergencyType;
    });
  }, [active, mapEmergencyStatus, mapEmergencyType]);

  const selectedUnassignedRequest = useMemo(() => {
    if (!selectedMapRequestId) return null;
    if (!filteredMapRequests.some((request) => request.id === selectedMapRequestId)) return null;
    return unassigned.find((request) => request.id === selectedMapRequestId) ?? null;
  }, [filteredMapRequests, selectedMapRequestId, unassigned]);

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
          <div className="flex flex-col items-end gap-2">
            <Badge tone="success">
              <span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]" />
              Operations online
            </Badge>
            <DispatcherCancellationInbox />
          </div>
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
          value={availableResponderCount}
          detail="Ready for assignment"
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
        <div className="grid min-w-0 gap-3">
          <div className="grid gap-3 border-b border-[#dbe3e8] pb-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-[#536b7b]">
              Emergency type
              <select
                value={mapEmergencyType}
                onChange={(event) => setMapEmergencyType(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-[#cbd8df] bg-white px-3 text-sm font-medium text-[#102b3f] outline-none focus-visible:ring-2 focus-visible:ring-[#0f6872]"
              >
                <option value="all">All types</option>
                {mapEmergencyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-[#536b7b]">
              Status
              <select
                value={mapEmergencyStatus}
                onChange={(event) => setMapEmergencyStatus(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-[#cbd8df] bg-white px-3 text-sm font-medium text-[#102b3f] outline-none focus-visible:ring-2 focus-visible:ring-[#0f6872]"
              >
                <option value="active">All active emergencies</option>
                {mapEmergencyStatuses.map((status) => <option key={status} value={status}>{formatRequestStatus(status)}</option>)}
              </select>
            </label>
          </div>
          <div className="relative min-w-0">
            <LiveResponseMap
              showAll
              requests={filteredMapRequests}
              onIncidentSelect={handleMapIncidentSelect}
              responders={availableResponders}
              operationalRoutes={activeOperationalRoutes}
              fallbackCenter={mapCenter}
              showMyLocation={false}
              immersive
            />
            {selectedUnassignedRequest ? (
              <div className="absolute inset-x-3 bottom-3 z-[1100] rounded-xl border border-[#d5e0e6] bg-white/95 p-3 shadow-lg backdrop-blur sm:inset-x-auto sm:left-3 sm:w-[min(390px,calc(100%-1.5rem))]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#102b3f]">
                      {selectedUnassignedRequest.category || "Emergency request"}
                    </p>
                    <p className="mt-1 text-xs text-[#536b7b]">
                      Awaiting responder assignment
                    </p>
                    <p className="mt-1 truncate text-xs text-[#71828d]">
                      {selectedUnassignedRequest.location?.address || selectedUnassignedRequest.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMapRequestId(null)}
                    aria-label="Close selected emergency"
                    className="shrink-0 rounded p-1 text-[#536b7b] hover:bg-[#eef3f5]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Link
                  href={`/app/dispatcher/requests/${encodeURIComponent(selectedUnassignedRequest.id)}`}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0f6872] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c5962]"
                >
                  Open this emergency in queue
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            ) : null}
          </div>
        </div>

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

          <div role="region" aria-label="Priority request list" tabIndex={0} className="max-h-[45vh] touch-pan-y overscroll-contain overflow-y-auto">
            {latestActive.slice(0, 5).map((request) => (
              <RequestListItem
                key={request.id}
                request={request}
                href={`/app/dispatcher/requests/${request.id}`}
                compact
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

"use client";

import {
  Building2,
  ClipboardList,
  Clock3,
  History,
  MapPin,
  MessageSquareText,
  PhoneCall,
  Send,
  Siren,
  UserRound,
} from "lucide-react";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { RequestIntakeAnswers } from "@/components/dispatcher/request-intake-answers";
import { useCall, useCallRoom } from "@/components/calls/call-provider";
import { LiveResponseMap } from "@/components/maps/live-response-map";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Select,
  Textarea,
} from "@/components/ui/field";

import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";

import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";

import { supabase } from "@/lib/supabase";
import { effectiveRequestStatus, formatRequestStatus, requestStatusTone } from "@/lib/utils";
import { readCached } from "@/lib/client-cache";

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
  return fetch(input, requestInit);
}

function formatClockTime(value?: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function DispatchRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { startCall, call } = useCall();
  useCallRoom(id);

  const [sheet, setSheet] = useState<
    null | "assign" | "reroute" | "reject" | "note"
  >(null);
  const [detailsSheet, setDetailsSheet] = useState<null | "history" | "notes" | "answers" | "requester">(null);

  // ==================================================
  // ASSIGNMENT SELECTION
  // ==================================================

  const [assignmentType, setAssignmentType] = useState<
    "team" | "responder"
  >("responder");

  const [responderId, setResponderId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [organisationId, setOrganisationId] = useState("");
  const [text, setText] = useState("");

  const [assignmentLoading, setAssignmentLoading] =
    useState(false);

  // ==================================================
  // DATA
  // ==================================================

  const [operationalNotes, setOperationalNotes] =
    useState<any[]>([]);

  const requestCacheKey = user?.id ? `dispatcher-requests:v3:${user.id}:${user.organisationId ?? "unassigned"}` : "";
  const cachedRequest = requestCacheKey
    ? readCached<any[]>(requestCacheKey)?.find((item) => item.id === decodeURIComponent(id)) ?? null
    : null;
  const [request, setRequest] = useState<any>(() => cachedRequest ? {
    ...cachedRequest,
    reference_code: cachedRequest.reference_code ?? cachedRequest.reference,
    requester_id: cachedRequest.requester_id ?? cachedRequest.requesterId,
    requester_name: cachedRequest.requester_name ?? cachedRequest.requesterName,
    callback_number: cachedRequest.callback_number ?? cachedRequest.callbackNumber,
    current_status: cachedRequest.current_status ?? cachedRequest.currentStatus ?? cachedRequest.status,
    routed_organisation_id: cachedRequest.routed_organisation_id ?? cachedRequest.organisationId,
  } : null);

  const [requestLoading, setRequestLoading] =
    useState(() => !cachedRequest);

  const [responders, setResponders] =
    useState<any[]>([]);

  const [teams, setTeams] =
    useState<any[]>([]);

  const [organisations, setOrganisations] =
    useState<any[]>([]);

  const [assignment, setAssignment] =
    useState<any>(null);

  const [assignedResponder, setAssignedResponder] =
    useState<any>(null);

  const [etaMinutes, setEtaMinutes] =
    useState("");

  // ==================================================
  // LOAD ALL REQUEST DATA
  // ==================================================

  async function loadRequestData() {
    try {
      if (!request) setRequestLoading(true);

      const requestId = decodeURIComponent(id);

      console.log(
        "========== LOADING DISPATCH REQUEST =========="
      );

      console.log(
        "Loading emergency request:",
        requestId
      );

      const requestResponse = await authenticatedFetch(`/api/requests/${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      const requestPayload = await requestResponse.json();
      if (!requestResponse.ok || requestPayload?.ok === false) {
        throw new Error(requestPayload?.message || "You cannot view this request.");
      }

      const requestDetail = requestPayload?.data ?? requestPayload;
      const location = requestDetail.location;
      const requestData = {
        ...requestDetail,
        reference_code: requestDetail.reference,
        requester_id: requestDetail.requesterId,
        requester_name: requestDetail.requesterName,
        callback_number: requestDetail.callbackNumber,
        current_status: requestDetail.currentStatus,
        is_active: requestDetail.isActive,
        is_cancelled: requestDetail.isCancelled,
        eta_minutes: requestDetail.etaMinutes,
        routed_organisation_id: requestDetail.organisationId,
        location: location ? {
          lat: Number(location.latitude),
          lng: Number(location.longitude),
          address: location.addressText ?? "Emergency request location",
          accuracy: location.accuracyMeters,
          method: location.locationMethod,
          capturedAt: location.capturedAt,
        } : null,
      };

      const resourcesResponse = await authenticatedFetch("/api/dispatcher/resources", {
        cache: "no-store",
      });
      const resourcesPayload = await resourcesResponse.json();
      if (!resourcesResponse.ok || resourcesPayload?.ok === false) {
        throw new Error(resourcesPayload?.message || "Unable to load organisation resources.");
      }
      const resources = resourcesPayload?.data ?? resourcesPayload;
      const busyResponderIds = new Set<string>(resources?.busyResponderIds ?? []);
      const responderProfiles = resources?.responders ?? [];

      setRequest(requestData);

      const activeStatuses = ["assigned", "acknowledged", "en_route", "arrived"];
      const latestAssignment = [...(requestDetail.assignments ?? [])]
        .reverse()
        .find((item: any) => activeStatuses.includes(String(item.status ?? "").toLowerCase()))
        ?? [...(requestDetail.assignments ?? [])].at(-1)
        ?? null;
      const assignmentData = latestAssignment ? {
        ...latestAssignment,
        responder_user_id: latestAssignment.responderUserId,
        team_id: latestAssignment.teamId,
        vehicle_id: latestAssignment.vehicleId,
        eta_minutes: latestAssignment.etaMinutes,
        assigned_at: latestAssignment.assignedAt,
        acknowledged_at: latestAssignment.acknowledgedAt,
        route_started_at: latestAssignment.routeStartedAt,
        arrived_at: latestAssignment.arrivedAt,
        completed_at: latestAssignment.completedAt,
      } : null;
      setAssignment(assignmentData);

      const effectiveStatus = effectiveRequestStatus(requestData.current_status, assignmentData?.status);
      if (effectiveStatus !== requestData.current_status) {
        setRequest((current: any) => current ? { ...current, current_status: effectiveStatus } : current);
      }

      if (assignmentData?.responder_user_id) {
        const assignedProfile = responderProfiles.find((profile: any) => profile.user_id === assignmentData.responder_user_id);
        setAssignedResponder({
          user_id: assignmentData.responder_user_id,
          name: assignmentData.responderName || assignedProfile?.user?.display_name || [assignedProfile?.user?.first_name, assignedProfile?.user?.last_name].filter(Boolean).join(" "),
          current_latitude: assignmentData.responderLatitude ?? assignedProfile?.current_latitude ?? null,
          current_longitude: assignmentData.responderLongitude ?? assignedProfile?.current_longitude ?? null,
          availability: assignedProfile?.availability,
        });
      } else {
        setAssignedResponder(null);
      }
      if (assignmentData?.eta_minutes !== null && assignmentData?.eta_minutes !== undefined) {
        setEtaMinutes(String(assignmentData.eta_minutes));
      }

      setResponders(responderProfiles.filter((profile: any) =>
        !busyResponderIds.has(profile.user_id)
        && String(profile.availability).toLowerCase() === "available",
      ));
      setOperationalNotes(requestDetail.operationalNotes ?? []);
      setTeams(resources?.teams ?? []);
      setOrganisations(resources?.organisations ?? []);

      console.log(
        "========== DISPATCH DATA LOADED =========="
      );
    } catch (error) {
      console.error(
        "Failed to load request data:",
        error
      );
    } finally {
      setRequestLoading(false);
    }
  }

  // ==================================================
  // LOAD DATA WHEN PAGE OPENS
  // ==================================================

  useEffect(() => {
    if (user && id) {
      loadRequestData();
    }
  }, [user, id]);

  useEffect(() => {
    const responderUserId = assignment?.responder_user_id;
    if (!responderUserId) return undefined;

    const refreshResponderLocation = async () => {
      const response = await authenticatedFetch(`/api/Emergency-request/${id}/assignments`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      const latestAssignment = payload?.assignment;
      const latestResponder = latestAssignment?.responder;
      if (latestAssignment && latestAssignment.responder_user_id === responderUserId) {
        setAssignedResponder({
          user_id: latestAssignment.responder_user_id,
          name:
            latestResponder?.user?.display_name ||
            [latestResponder?.user?.first_name, latestResponder?.user?.last_name]
              .filter(Boolean)
              .join(" ") ||
            "Responder",
          current_latitude: latestResponder?.current_latitude ?? null,
          current_longitude: latestResponder?.current_longitude ?? null,
        });
      }
    };

    const timer = window.setInterval(() => {
      void refreshResponderLocation();
    }, 3_000);

    return () => window.clearInterval(timer);
  }, [assignment?.responder_user_id, id]);

  // ==================================================
  // UPDATE ASSIGNMENT STATUS
  // ==================================================

  async function updateAssignmentStatus(
    newStatus:
      | "assigned"
      | "acknowledged"
      | "en_route"
      | "arrived"
      | "completed"
      | "cancelled"
      | "rejected"
  ) {
    if (!assignment?.id) {
      alert(
        "No assignment exists for this request."
      );

      return;
    }

    setAssignmentLoading(true);

    try {
      const now =
        new Date().toISOString();

      const updates: any = {
        status: newStatus,
        updated_at: now,
      };

      if (
        newStatus === "acknowledged"
      ) {
        updates.acknowledged_at = now;
      }

      if (
        newStatus === "en_route"
      ) {
        updates.route_started_at = now;
      }

      if (
        newStatus === "arrived"
      ) {
        updates.arrived_at = now;
      }

      if (
        newStatus === "completed"
      ) {
        updates.completed_at = now;
      }

      if (
        newStatus === "cancelled"
      ) {
        updates.cancelled_at = now;
      }

      if (
        newStatus === "rejected"
      ) {
        updates.rejected_at = now;
      }

      // ==================================================
      // UPDATE ASSIGNMENT
      // ==================================================

      const {
        error: assignmentError,
      } = await supabase
        .from("request_assignments")
        .update(updates)
        .eq("id", assignment.id);

      if (assignmentError) {
        console.error(
          "Failed to update assignment:",
          assignmentError
        );

        alert(
          `Failed to update assignment status: ${assignmentError.message}`
        );

        return;
      }

      const updatedAssignment = {
        ...assignment,
        ...updates,
      };

      setAssignment(
        updatedAssignment
      );

      // ==================================================
      // MAP ASSIGNMENT STATUS TO REQUEST STATUS
      // ==================================================

      let emergencyRequestStatus:
        | "submitted"
        | "assigned"
        | "en_route"
        | "arrived"
        | "closed"
        | "cancelled"
        | "rejected"
        | null = null;

      if (
        newStatus === "assigned" ||
        newStatus === "acknowledged"
      ) {
        emergencyRequestStatus =
          "assigned";
      }

      if (
        newStatus === "en_route"
      ) {
        emergencyRequestStatus =
          "en_route";
      }

      if (
        newStatus === "arrived"
      ) {
        emergencyRequestStatus =
          "arrived";
      }

      if (
        newStatus === "completed"
      ) {
        emergencyRequestStatus =
          "closed";
      }

      if (
        newStatus === "cancelled"
      ) {
        emergencyRequestStatus =
          "cancelled";
      }

      if (
        newStatus === "rejected"
      ) {
        emergencyRequestStatus =
          "rejected";
      }

      // ==================================================
      // UPDATE EMERGENCY REQUEST
      // ==================================================

      if (
        emergencyRequestStatus
      ) {
        const {
          error: requestError,
        } = await supabase
          .from("emergency_requests")
          .update({
            current_status:
              emergencyRequestStatus,
            updated_at: now,
          })
          .eq("id", request.id);

        if (requestError) {
          console.error(
            "Failed to update emergency request status:",
            requestError
          );

          alert(
            `Assignment was updated, but the emergency request status could not be updated: ${requestError.message}`
          );

          return;
        }
      }

      // ==================================================
      // LOCAL REQUEST STATE
      // ==================================================

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,
                current_status:
                  emergencyRequestStatus ??
                  current.current_status,
                updated_at: now,
              }
            : current
      );

      // ==================================================
      // RESPONDER AVAILABILITY
      // ==================================================

      let responderAvailability:
        | "available"
        | "assigned"
        | "en_route"
        | "on_scene"
        | null = null;

      if (
        newStatus === "assigned" ||
        newStatus === "acknowledged"
      ) {
        responderAvailability =
          "assigned";
      }

      if (
        newStatus === "en_route"
      ) {
        responderAvailability =
          "en_route";
      }

      if (
        newStatus === "arrived"
      ) {
        responderAvailability =
          "on_scene";
      }

      if (
        newStatus === "completed" ||
        newStatus === "cancelled" ||
        newStatus === "rejected"
      ) {
        responderAvailability =
          "available";
      }

      if (
        responderAvailability &&
        assignment.responder_user_id
      ) {
        const {
          error: availabilityError,
        } = await supabase
          .from("responder_profiles")
          .update({
            availability:
              responderAvailability,
            updated_at: now,
          })
          .eq(
            "user_id",
            assignment.responder_user_id
          );

        if (availabilityError) {
          console.error(
            "Failed to update responder availability:",
            availabilityError
          );
        }
      }

      // ==================================================
      // TEAM STATUS
      // ==================================================

      if (assignment.team_id) {
        let teamStatus:
          | "available"
          | "assigned"
          | "en_route"
          | "on_scene"
          | null = null;

        if (
          newStatus === "assigned" ||
          newStatus === "acknowledged"
        ) {
          teamStatus = "assigned";
        }

        if (
          newStatus === "en_route"
        ) {
          teamStatus = "en_route";
        }

        if (
          newStatus === "arrived"
        ) {
          teamStatus = "on_scene";
        }

        if (
          newStatus === "completed" ||
          newStatus === "cancelled" ||
          newStatus === "rejected"
        ) {
          teamStatus = "available";
        }

        if (teamStatus) {
          const {
            error: teamError,
          } = await supabase
            .from("responder_teams")
            .update({
              status: teamStatus,
              updated_at: now,
            })
            .eq(
              "id",
              assignment.team_id
            );

          if (teamError) {
            console.error(
              "Failed to update team availability:",
              teamError
            );
          }
        }
      }

      // ==================================================
      // REFRESH
      // ==================================================

      if (
        newStatus === "completed" ||
        newStatus === "cancelled" ||
        newStatus === "rejected"
      ) {
        await loadRequestData();
      }

      console.log(
        "REQUEST + ASSIGNMENT SYNCHRONIZED:",
        {
          assignmentStatus:
            newStatus,
          emergencyRequestStatus,
        }
      );

      alert(
        `Assignment status updated to ${newStatus}.`
      );
    } catch (error) {
      console.error(
        "Unexpected assignment status error:",
        error
      );

      alert(
        "An unexpected error occurred while updating the assignment."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  // ==================================================
  // UPDATE ETA
  // ==================================================

  async function updateAssignmentEta() {
    if (!assignment?.id) {
      alert(
        "No assignment exists for this request."
      );

      return;
    }

    const minutes =
      Number(etaMinutes);

    if (
      !Number.isFinite(minutes) ||
      minutes < 0
    ) {
      alert(
        "Enter a valid ETA in minutes."
      );

      return;
    }

    setAssignmentLoading(true);

    try {
      const now =
        new Date().toISOString();

      const estimatedArrival =
        new Date(
          Date.now() +
            minutes * 60 * 1000
        ).toISOString();

      // ==================================================
      // UPDATE ASSIGNMENT ETA
      // ==================================================

      const {
        data: updatedAssignment,
        error: assignmentError,
      } = await supabase
        .from("request_assignments")
        .update({
          eta_minutes: minutes,
          updated_at: now,
        })
        .eq("id", assignment.id)
        .select("*")
        .single();

      if (assignmentError) {
        console.error(
          "Failed to update assignment ETA:",
          assignmentError
        );

        alert(
          `Failed to update assignment ETA: ${assignmentError.message}`
        );

        return;
      }

      console.log(
        "REQUEST ASSIGNMENT ETA UPDATED:",
        updatedAssignment
      );

      // ==================================================
      // UPDATE REQUEST ETA
      // ==================================================

      const {
        data: updatedRequestRows,
        error: requestError,
      } = await supabase
        .from("emergency_requests")
        .update({
          eta_minutes: minutes,
          estimated_arrival_at:
            estimatedArrival,
          updated_at: now,
        })
        .eq("id", request.id)
        .select(
          "id, eta_minutes, estimated_arrival_at, updated_at"
        );

      if (requestError) {
        console.error(
          "Failed to update emergency request ETA:",
          requestError
        );

        alert(
          `Assignment ETA was updated, but emergency request ETA could not be updated: ${requestError.message}`
        );

        return;
      }

      if (
        !updatedRequestRows ||
        updatedRequestRows.length === 0
      ) {
        alert(
          "Assignment ETA was updated, but the emergency request was not updated. Check the emergency_requests RLS UPDATE policy."
        );

        return;
      }

      const updatedRequest =
        updatedRequestRows[0];

      console.log(
        "EMERGENCY REQUEST ETA UPDATED:",
        updatedRequest
      );

      // ==================================================
      // LOCAL ASSIGNMENT
      // ==================================================

      setAssignment(
        (current: any) =>
          current
            ? {
                ...current,
                eta_minutes: minutes,
                updated_at: now,
              }
            : current
      );

      // ==================================================
      // LOCAL REQUEST
      // ==================================================

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,
                eta_minutes: minutes,
                estimated_arrival_at:
                  estimatedArrival,
                updated_at: now,
              }
            : current
      );

      alert(
        `ETA updated to ${minutes} minutes.`
      );
    } catch (error) {
      console.error(
        "Unexpected ETA update error:",
        error
      );

      alert(
        "An unexpected error occurred while updating the ETA."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  // ==================================================
  // ASSIGN TEAM OR RESPONDER
  // ==================================================

  async function assignResource() {
    if (
      assignmentType === "responder" &&
      !responderId
    ) {
      alert(
        "Please select a responder."
      );

      return;
    }

    if (
      assignmentType === "team" &&
      !teamId
    ) {
      alert(
        "Please select a team."
      );

      return;
    }

    if (!user) {
      alert(
        "You must be logged in to assign a resource."
      );

      return;
    }

    if (assignment?.id && ["assigned", "acknowledged", "en_route", "arrived"].includes(String(assignment.status ?? "").toLowerCase())) {
      alert(
        "This request already has an assignment."
      );

      return;
    }

    setAssignmentLoading(true);

    try {
      const now = new Date().toISOString();

      console.log(
        "STARTING RESOURCE ASSIGNMENT:",
        {
          requestId: request.id,
          assignmentType,
          teamId:
            assignmentType === "team"
              ? teamId
              : null,
          responderId:
            assignmentType === "responder"
              ? responderId
              : null,
          dispatcherId: user.id,
        }
      );

      let selectedTeam: any = null;
      let selectedResponder: any = null;
      let selectedOrganisationId = "";

      // ==================================================
      // TEAM
      // ==================================================

      if (
        assignmentType === "team"
      ) {
        selectedTeam =
          teams.find(
            (team) =>
              team.id === teamId
          );

        if (!selectedTeam) {
          alert(
            "Selected team could not be found."
          );

          return;
        }

        if (
          !selectedTeam.organisation_id
        ) {
          alert(
            "The selected team is not linked to an organisation."
          );

          return;
        }

        selectedOrganisationId =
          selectedTeam.organisation_id;
      }

      // ==================================================
      // RESPONDER
      // ==================================================

      if (
        assignmentType === "responder"
      ) {
        selectedResponder =
          responders.find(
            (responder) =>
              responder.user_id ===
              responderId
          );

        if (!selectedResponder) {
          alert(
            "Selected responder could not be found."
          );

          return;
        }

        if (
          !selectedResponder.organisation_id
        ) {
          alert(
            "The selected responder is not linked to an organisation."
          );

          return;
        }

        selectedOrganisationId =
          selectedResponder.organisation_id;
      }

      // ==================================================
      // CREATE ASSIGNMENT
      // ==================================================

      const assignmentResponse = await authenticatedFetch(
        `/api/Emergency-request/${encodeURIComponent(request.id)}/assignments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organisation_id: selectedOrganisationId,
            team_id: assignmentType === "team" ? teamId : null,
            responder_user_id: assignmentType === "responder" ? responderId : null,
            eta_minutes: etaMinutes.trim() ? Number(etaMinutes) : null,
          }),
        },
      );
      const assignmentPayload = await assignmentResponse.json().catch(() => ({}));
      if (!assignmentResponse.ok || !assignmentPayload?.ok || !assignmentPayload?.assignment) {
        alert(assignmentPayload?.message || "The responder could not be assigned. Refresh the request and try again.");
        return;
      }

      const assignmentData = assignmentPayload.assignment;

      // ==================================================
      // LOCAL REQUEST
      // ==================================================

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,
                current_status:
                  "assigned",
                routed_organisation_id:
                  selectedOrganisationId,
                assigned_at: now,
                updated_at: now,
              }
            : current
      );

      // ==================================================
      // LOCAL ASSIGNMENT
      // ==================================================

      setAssignment(
        assignmentData
      );

      // ==================================================
      // REMOVE RESOURCE FROM DROPDOWN
      // ==================================================

      if (
        assignmentType === "responder"
      ) {
        setResponders(
          (current) =>
            current.filter(
              (responder) =>
                responder.user_id !==
                responderId
            )
        );
      }

      if (
        assignmentType === "team"
      ) {
        setTeams(
          (current) =>
            current.filter(
              (team) =>
                team.id !== teamId
            )
        );
      }

      setSheet(null);
      setResponderId("");
      setTeamId("");

      alert(
        assignmentType === "team"
          ? "Team assigned successfully."
          : "Responder assigned successfully."
      );
    } catch (error) {
      console.error(
        "Unexpected assignment error:",
        error
      );

      alert(
        "An unexpected error occurred while assigning the resource."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  // ==================================================
  // SHEET ACTIONS
  // ==================================================

  async function completeSheet() {
    // ==================================================
    // ASSIGN
    // ==================================================

    if (sheet === "assign") {
      await assignResource();
      return;
    }

    // ==================================================
    // REROUTE
    // ==================================================

    if (sheet === "reroute") {
      if (user?.role !== "admin") {
        alert("Only an administrator can reroute a request to another organisation.");
        return;
      }
      if (
        !organisationId ||
        !text.trim()
      ) {
        alert(
          "Please select an organisation and provide a reason."
        );

        return;
      }

      if (!user) {
        alert(
          "You must be logged in to reroute a request."
        );

        return;
      }

      if (!request?.id) {
        alert(
          "The emergency request could not be found."
        );

        return;
      }

      setAssignmentLoading(true);

      try {
        const now =
          new Date().toISOString();

        const reason =
          text.trim();

        const correlationId =
          crypto.randomUUID();

        console.log(
          "STARTING REROUTE:",
          {
            requestId: request.id,
            fromOrganisation:
              request.routed_organisation_id,
            toOrganisation:
              organisationId,
            reason,
            dispatcherId:
              user.id,
            correlationId,
          }
        );

        // ==================================================
        // UPDATE REQUEST
        // ==================================================

        const {
          data: updatedRequest,
          error: requestUpdateError,
        } = await supabase
          .from("emergency_requests")
          .update({
            routed_organisation_id:
              organisationId,
            updated_at: now,
          })
          .eq("id", request.id)
          .select("*")
          .single();

        if (requestUpdateError) {
          console.error(
            "FAILED TO REROUTE EMERGENCY REQUEST:",
            requestUpdateError
          );

          alert(
            `Failed to reroute request: ${requestUpdateError.message}`
          );

          return;
        }

        console.log(
          "EMERGENCY REQUEST REROUTED:",
          updatedRequest
        );

        // ==================================================
        // UPDATE CURRENT ASSIGNMENT
        // ==================================================

        if (assignment?.id) {
          const {
            data: updatedAssignment,
            error:
              assignmentUpdateError,
          } = await supabase
            .from("request_assignments")
            .update({
              organisation_id:
                organisationId,
              assignment_note:
                reason,
              updated_at: now,
            })
            .eq(
              "id",
              assignment.id
            )
            .select("*")
            .single();

          if (
            assignmentUpdateError
          ) {
            console.error(
              "FAILED TO UPDATE ASSIGNMENT ORGANISATION:",
              assignmentUpdateError
            );

            alert(
              `Request was rerouted, but the assignment could not be updated: ${assignmentUpdateError.message}`
            );

            return;
          }

          setAssignment(
            updatedAssignment
          );
        }

        // ==================================================
        // CREATE REROUTE HISTORY
        // ==================================================

        const {
          data: historyEntry,
          error: historyError,
        } = await supabase
          .from("request_status_history")
          .insert({
            request_id: request.id,
            previous_status:
              request.current_status,
            new_status:
              request.current_status,
            changed_by_user_id:
              user.id,
            actor_role: "dispatcher",
            changed_by_system: false,
            reason: "reroute",
            note:
              `Request rerouted to organisation. Reason: ${reason}`,
            correlation_id:
              correlationId,
          })
          .select("*")
          .single();

        if (historyError) {
          console.error(
            "REROUTE HISTORY INSERT FAILED:",
            historyError
          );

          alert(
            `Reroute completed, but history could not be recorded: ${historyError.message}`
          );

          return;
        }

        console.log(
          "REROUTE HISTORY CREATED:",
          historyEntry
        );

        // ==================================================
        // LOCAL REQUEST
        // ==================================================

        setRequest(
          (current: any) =>
            current
              ? {
                  ...current,
                  routed_organisation_id:
                    organisationId,
                  updated_at: now,
                }
              : current
        );

        setSheet(null);
        setOrganisationId("");
        setText("");

        await loadRequestData();

        alert(
          "Request rerouted successfully and the status history was recorded."
        );
      } catch (error) {
        console.error(
          "UNEXPECTED REROUTE ERROR:",
          error
        );

        alert(
          "An unexpected error occurred while rerouting the request."
        );
      } finally {
        setAssignmentLoading(false);
      }

      return;
    }

    // ==================================================
    // REJECT
    // ==================================================

    if (sheet === "reject") {
      if (!text.trim()) {
        alert(
          "Please provide a rejection reason."
        );

        return;
      }

      console.log(
        "REJECT REQUEST",
        {
          requestId:
            request.id,
          reason: text,
          dispatcherId:
            user?.id,
        }
      );

      alert(
        "Rejection will be connected to Supabase next."
      );

      setSheet(null);
      setText("");

      return;
    }

    // ==================================================
    // OPERATIONAL NOTE
    // ==================================================

    if (sheet === "note") {
      if (!text.trim()) {
        alert(
          "Please enter an operational note."
        );

        return;
      }

      setAssignmentLoading(true);
      try {
        const response = await authenticatedFetch(
          `/api/requests/${encodeURIComponent(request.id)}/notes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              note: text.trim(),
              requesterVisible: false,
            }),
          },
        );

        const result =
          await response.json();

        if (
          !response.ok ||
          !result?.ok
        ) {
          alert(
            result?.error?.message ||
              "Failed to save operational note."
          );

          return;
        }

        setSheet(null);
        setText("");

        await loadRequestData();
      } catch (error) {
        console.error(
          "Operational note request failed:",
          error
        );

        alert(
          "Unable to save operational note."
        );
      } finally {
        setAssignmentLoading(false);
      }

      return;
    }
  }

  // ==================================================
  // LOADING
  // ==================================================

  if (
    !user ||
    requestLoading
  ) {
    return (
      <PageSkeleton map />
    );
  }

  // ==================================================
  // REQUEST NOT FOUND
  // ==================================================

  if (!request) {
    return (
      <div className="app-page">
        <Panel className="p-8 text-center">
          <h1 className="text-xl font-bold">
            Emergency request not found.
          </h1>

          <Button
            className="mt-5"
            onClick={() =>
              router.replace(
                "/app/dispatcher/requests"
              )
            }
          >
            Back to queue
          </Button>
        </Panel>
      </div>
    );
  }

  // ==================================================
  // DISPLAYED STATUS
  // ==================================================

  const displayedStatus = formatRequestStatus(
    effectiveRequestStatus(request.current_status, assignment?.status),
  );

  const terminalAssignment =
    [
      "completed",
      "cancelled",
      "rejected",
    ].includes(
      assignment?.status
    );

  // ==================================================
  // PAGE
  // ==================================================

  return (
    <div className="app-page grid gap-5">

      {/* ==================================================
          PAGE HEADING
          ================================================== */}

      <PageHeading
        eyebrow="Dispatch request"
        title={
          request.reference_code
        }
        description={`${request.category} Â· ${request.severity} priority`}
        action={
          <Badge
            tone={requestStatusTone(
              displayedStatus as any
            )}
            className="min-h-9 px-4"
          >
            {displayedStatus}
          </Badge>
        }
      />

      {/* ==================================================
          MAP + REQUEST INFORMATION
          ================================================== */}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">

        <div className="grid min-w-0 content-start gap-4">
          <LiveResponseMap
            request={request}
            responder={assignedResponder?.current_latitude != null && assignedResponder?.current_longitude != null
              ? {
                  location: {
                    lat: Number(assignedResponder.current_latitude),
                    lng: Number(assignedResponder.current_longitude),
                  },
                  name: assignedResponder?.name || "Responder",
                }
              : undefined}
            responderAssigned={Boolean(assignment?.responder_user_id)}
            responderName={assignedResponder?.name || "Responder"}
            requesterName={request.requester_name || request.requesterName || "Requester"}
            responderStatus={assignment?.status}
            showMyLocation={false}
            immersive
          />

          <Panel>
            <PanelHeader title="Request activity" description="Open the timeline, notes, emergency answers, or requester details." />
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <Button type="button" variant="outline" className="h-auto min-h-10 justify-center gap-1.5 whitespace-normal px-2 py-2 text-center text-xs leading-tight" onClick={() => setDetailsSheet("history")}>
                <History className="h-4 w-4 shrink-0" />
                <span>Status history</span>
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{request.history?.length ?? 0}</span>
              </Button>
              <Button type="button" variant="outline" className="h-auto min-h-10 justify-center gap-1.5 whitespace-normal px-2 py-2 text-center text-xs leading-tight" onClick={() => setDetailsSheet("notes")}>
                <ClipboardList className="h-4 w-4 shrink-0" />
                <span>Operational notes</span>
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{operationalNotes.length}</span>
              </Button>
              <Button type="button" variant="outline" className="h-auto min-h-10 justify-center gap-1.5 whitespace-normal px-2 py-2 text-center text-xs leading-tight" onClick={() => setDetailsSheet("answers")}>
                <MessageSquareText className="h-4 w-4 shrink-0" />
                <span>Requester emergency answers</span>
              </Button>
              <Button type="button" variant="outline" className="h-auto min-h-10 justify-center gap-1.5 whitespace-normal px-2 py-2 text-center text-xs leading-tight" onClick={() => setDetailsSheet("requester")}>
                <UserRound className="h-4 w-4 shrink-0" />
                <span>Requester details</span>
              </Button>
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-4">

          {/* ==================================================
              OPERATIONAL ACTIONS
              ================================================== */}

          <Panel>
            <PanelHeader
              title="Operational actions"
              description="Dispatcher controls for this emergency request."
            />

            <div className="grid gap-2 p-4 sm:grid-cols-2">

              {!assignment ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    setSheet(
                      "assign"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Assign response resource
                </Button>
              ) : null}

              {assignment?.status ===
              "assigned" ? (
                <Button
                  onClick={() =>
                    updateAssignmentStatus(
                      "acknowledged"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Acknowledge assignment
                </Button>
              ) : null}

              {assignment?.status ===
              "acknowledged" ? (
                <Button
                  onClick={() =>
                    updateAssignmentStatus(
                      "en_route"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Start route
                </Button>
              ) : null}

              {user?.role === "admin" && assignment?.status === "completed" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    setSheet(
                      "reroute"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Reroute
                </Button>
              ) : null}

              <Button
                variant="outline"
                onClick={() =>
                  setSheet("note")
                }
                disabled={
                  assignmentLoading
                }
              >
                Add note
              </Button>

            </div>
          </Panel>

          {/* ==================================================
              REQUEST INFORMATION
              ================================================== */}

          <Panel>
            <PanelHeader title="Request information" />

            <dl className="divide-y divide-[#e2e8ed] text-sm">

              <div className="flex items-start gap-3 p-4">
                <PhoneCall className="h-5 w-5 text-[#0f5b67]" />

                <div className="min-w-0 flex-1">
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Requester
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {request.requester_name || request.requester_id || "Requester"}
                  </dd>

                  {request.requester_name && request.requester_id ? <dd className="mt-1 text-xs text-[#71828d]">ID: {request.requester_id}</dd> : null}

                  <dd className="mt-1 text-[#617582]">
                    {
                      request.callback_number
                    }
                  </dd>

                </div>

                <Button
                    type="button"
                    size="sm"
                    className="ml-auto shrink-0"
                    disabled={!id || call.status !== "idle"}
                    onClick={() => void startCall(id, "Requester", { targetRole: "requester" })}
                  >
                    <PhoneCall className="h-4 w-4" />
                    Call requester
                  </Button>
              </div>

              {assignment?.responder_user_id ? (
                <div className="flex items-start gap-3 border-t border-[#e2e8ed] p-4">
                  <PhoneCall className="h-5 w-5 text-[#0f5b67]" />
                  <div className="min-w-0 flex-1">
                    <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Responder
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {assignedResponder?.name || "Assigned responder"}
                    </dd>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-auto shrink-0"
                    disabled={call.status !== "idle"}
                    onClick={() => void startCall(id, "Responder", { targetUserId: assignment.responder_user_id })}
                  >
                    <PhoneCall className="h-4 w-4" />
                    Call responder
                  </Button>
                </div>
              ) : null}

              <div className="flex gap-3 p-4">
                <Clock3 className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Estimated arrival
                  </dt>

                  <dd className="mt-1 text-[#617582]">
                    {assignment?.eta_minutes !== null && assignment?.eta_minutes !== undefined
                      ? `${assignment.eta_minutes} minutes`
                      : "Not available"}
                  </dd>
                </div>
              </div>

              <div className="flex gap-3 p-4">
                <MapPin className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Location
                  </dt>

                  <dd className="mt-1 text-[#71828d]">
                    {request.location?.address ||
                      (Number.isFinite(Number(request.location?.lat)) && Number.isFinite(Number(request.location?.lng))
                        ? `${Number(request.location.lat).toFixed(5)}, ${Number(request.location.lng).toFixed(5)}`
                        : "Location data not available on this request.")}
                  </dd>
                </div>
              </div>

              <div className="flex gap-3 p-4">
                <Building2 className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Routing
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {assignment
                      ? assignment.organisation_id
                      : request.routed_organisation_id ||
                        "Unassigned"}
                  </dd>

                  <dd className="mt-1 text-xs text-[#71828d]">
                    {assignment?.team_id
                      ? `Team: ${assignment.team_id}`
                      : assignment?.responder_user_id
                      ? `Responder: ${assignment.responder_user_id}`
                      : "No resource assigned"}
                  </dd>
                </div>
              </div>

              <div className="flex gap-3 p-4">
                <Siren className="h-5 w-5 text-[#d53f3d]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Incident note
                  </dt>

                  <dd className="mt-1 leading-6">
                    {request.note ||
                      "No incident note."}
                  </dd>
                </div>
              </div>

            </dl>
          </Panel>
        </div>
      </div>

      <Sheet
        open={detailsSheet !== null}
        onOpenChange={(open) => { if (!open) setDetailsSheet(null); }}
        title={detailsSheet === "history" ? "Status history" : detailsSheet === "notes" ? "Operational notes" : detailsSheet === "requester" ? "Requester details" : "Requester emergency answers"}
        description={detailsSheet === "answers" ? "Updates automatically while this request is open." : request.reference_code}
        side="right"
      >
        {detailsSheet === "answers" ? <RequestIntakeAnswers requestId={request.id} /> : null}

        {detailsSheet === "requester" ? <div className="grid gap-4 p-4">
          <Panel>
            <PanelHeader title="Emergency contact" />
            <dl className="grid gap-3 p-4 text-sm">
              <div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Name</dt><dd className="mt-1 font-semibold text-[#102b3f]">{request.requesterEmergencyContact?.name || "Not provided"}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Phone</dt><dd className="mt-1 text-[#455d6d]">{request.requesterEmergencyContact?.phone || "Not provided"}</dd></div>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="Medical details" />
            <dl className="divide-y divide-[#e2e8ed] px-4 text-sm">
              {[
                ["Conditions", request.requesterMedicalDetails?.conditions],
                ["Allergies", request.requesterMedicalDetails?.allergies],
                ["Medications", request.requesterMedicalDetails?.medications],
              ].map(([label, value]) => <div key={label} className="py-3"><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-[#455d6d]">{value || "Not provided"}</dd></div>)}
            </dl>
          </Panel>
        </div> : null}

        {detailsSheet === "history" && request.history?.length ? <Panel className="m-4">
          <div role="region" aria-label="Complete request status history" tabIndex={0} className="max-h-[70vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
            {request.history.map((entry: any) => (
              <article key={entry.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#102b3f]">
                      {entry.previousStatus ? `${formatRequestStatus(entry.previousStatus)} to ` : ""}{formatRequestStatus(entry.newStatus)}
                    </p>
                    <p className="mt-1 text-xs text-[#71828d]">
                      {entry.changedBySystem ? "System" : entry.actorRole || "Unknown actor"}
                      {entry.changedByUserId ? ` | ${entry.changedByUserId}` : ""}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-[#71828d]">{formatClockTime(entry.createdAt)}</time>
                </div>
                {entry.reason ? <p className="mt-2 text-xs font-medium text-[#526a78]">Reason: {String(entry.reason).replaceAll("_", " ")}</p> : null}
                {entry.note ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#455d6d]">{entry.note}</p> : null}
              </article>
            ))}
          </div>
        </Panel> : null}

        {detailsSheet === "history" && !request.history?.length ? <Panel className="m-4">
          <div className="p-5">

            {!assignment ? (
              <div className="text-sm text-[#71828d]">

                <p>
                  No responder or team assignment has been created yet.
                </p>

                <p className="mt-2">
                  Request status:{" "}
                  <span className="font-semibold text-[#102b3f]">
                    {
                      request.current_status
                    }
                  </span>
                </p>

              </div>
            ) : (
              <div className="space-y-4 text-sm">

                <div className="flex gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-[#0f5b67]" />

                  <div>
                    <p className="font-semibold text-[#102b3f]">
                      Assigned
                    </p>

                    <p className="text-[#71828d]">
                      {assignment.team_id
                        ? "Response team assigned to this emergency."
                        : "Responder assigned to this emergency."}
                    </p>

                    {assignment.assigned_at ? (
                      <p className="mt-1 text-xs text-[#8a9aa5]">
                        {formatClockTime(assignment.assigned_at)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {[
                  "acknowledged",
                  "en_route",
                  "arrived",
                  "completed",
                ].includes(
                  assignment.status
                ) ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#0f5b67]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        Acknowledged
                      </p>

                      {assignment.acknowledged_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                          {formatClockTime(assignment.acknowledged_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {[
                  "en_route",
                  "arrived",
                  "completed",
                ].includes(
                  assignment.status
                ) ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#0f5b67]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        En route
                      </p>

                      {assignment.route_started_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                          {formatClockTime(assignment.route_started_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {[
                  "arrived",
                  "completed",
                ].includes(
                  assignment.status
                ) ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#0f5b67]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        Arrived at scene
                      </p>

                      {assignment.arrived_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                          {formatClockTime(assignment.arrived_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {assignment.status ===
                "completed" ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#0f5b67]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        Completed
                      </p>

                      {assignment.completed_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                        {formatClockTime(assignment.completed_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {assignment.status ===
                "cancelled" ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#d53f3d]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        Cancelled
                      </p>

                      {assignment.cancelled_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                        {formatClockTime(assignment.cancelled_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {assignment.status ===
                "rejected" ? (
                  <div className="flex gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[#d53f3d]" />

                    <div>
                      <p className="font-semibold text-[#102b3f]">
                        Rejected
                      </p>

                      {assignment.rejected_at ? (
                        <p className="text-xs text-[#8a9aa5]">
                        {formatClockTime(assignment.rejected_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 rounded-lg bg-[#f5f8fa] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Current assignment status
                  </p>

                  <p className="mt-1 font-bold capitalize text-[#102b3f]">
                    {assignment.status.replace(
                      "_",
                      " "
                    )}
                  </p>
                </div>

                <div className="rounded-lg bg-[#f5f8fa] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Assigned resource
                  </p>

                  <p className="mt-1 font-bold text-[#102b3f]">
                    {assignment.team_id
                      ? "Response Team"
                      : "Individual Responder"}
                  </p>

                  <p className="mt-1 text-xs text-[#71828d]">
                    {assignment.team_id
                      ? assignment.team_id
                      : assignment.responder_user_id}
                  </p>
                </div>

                <div className="rounded-lg bg-[#f5f8fa] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Emergency request status
                  </p>

                  <p className="mt-1 font-bold capitalize text-[#102b3f]">
            {formatRequestStatus(request.current_status)}
                  </p>
                </div>

              </div>
            )}

          </div>
        </Panel> : null}

        {/* ==================================================
            OPERATIONAL NOTES
            ================================================== */}

        {detailsSheet === "notes" ? <Panel className="m-4">
          {operationalNotes.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#71828d]">
              No operational notes available.
            </p>
          ) : (
            <div role="region" aria-label="Operational notes list" tabIndex={0} className="max-h-[55vh] touch-pan-y overscroll-contain overflow-y-auto space-y-3 p-4">
              {operationalNotes.map(
                (note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border p-3"
                  >
                    <p className="text-sm">
                      {note.note}
                    </p>

                    <p className="mt-2 text-xs text-[#71828d]">
                      {formatClockTime(note.createdAt ?? note.created_at)}
                    </p>
                  </div>
                )
              )}
            </div>
          )}
        </Panel> : null}

      </Sheet>

      {/* ==================================================
          ACTION SHEET
          ================================================== */}

      <Sheet
        open={
          sheet !== null
        }
        dismissible={!assignmentLoading}
        onOpenChange={(
          open
        ) => {
          if (!open) {
            setSheet(null);
            setText("");
            setResponderId("");
            setTeamId("");
            setOrganisationId("");
          }
        }}
        title={
          sheet === "assign"
            ? "Assign a response resource"
            : sheet === "reroute"
            ? "Reroute request"
            : sheet === "reject"
            ? "Reject request"
            : "Add operational note"
        }
        description={
          request.reference_code
        }
      >

        <div className="grid gap-4 p-5">

          {/* ==================================================
              ASSIGNMENT TYPE
              ================================================== */}

          {sheet === "assign" ? (
            <>
              <div>
                <FieldLabel>
                  Assignment type
                </FieldLabel>

                <div className="mt-2 grid grid-cols-2 gap-2">

                  <Button
                    type="button"
                    variant={
                      assignmentType ===
                      "team"
                        ? "primary"
                        : "outline"
                    }
                    onClick={() => {
                      setAssignmentType(
                        "team"
                      );

                      setResponderId("");
                    }}
                    disabled={
                      assignmentLoading
                    }
                  >
                    Assign team
                  </Button>

                  <Button
                    type="button"
                    variant={
                      assignmentType ===
                      "responder"
                        ? "primary"
                        : "outline"
                    }
                    onClick={() => {
                      setAssignmentType(
                        "responder"
                      );

                      setTeamId("");
                    }}
                    disabled={
                      assignmentLoading
                    }
                  >
                    Assign responder
                  </Button>

                </div>
              </div>

              {/* ==================================================
                  TEAM SELECTION
                  ================================================== */}

              {assignmentType ===
              "team" ? (
                <label>
                  <FieldLabel>
                    Response team
                  </FieldLabel>

                  <Select
                    value={teamId}
                    onChange={(e) =>
                      setTeamId(
                        e.target.value
                      )
                    }
                    disabled={
                      assignmentLoading
                    }
                  >
                    <option value="">
                      Select an available team
                    </option>

                    {teams.length === 0 ? (
                      <option
                        value=""
                        disabled
                      >
                        No available teams found
                      </option>
                    ) : null}

                    {teams.map(
                      (team) => (
                        <option
                          key={
                            team.id
                          }
                          value={
                            team.id
                          }
                        >
                          {team.name}

                          {team.code
                            ? ` Â· ${team.code}`
                            : ""}
                        </option>
                      )
                    )}
                  </Select>
                </label>
              ) : null}

              {/* ==================================================
                  RESPONDER SELECTION
                  ================================================== */}

              {assignmentType ===
              "responder" ? (
                <label>
                  <FieldLabel>
                    Responder
                  </FieldLabel>

                  <Select
                    value={
                      responderId
                    }
                    onChange={(e) =>
                      setResponderId(
                        e.target.value
                      )
                    }
                    disabled={
                      assignmentLoading
                    }
                  >
                    <option value="">
                      Select an available responder
                    </option>

                    {responders.length === 0 ? (
                      <option
                        value=""
                        disabled
                      >
                        No available responders found
                      </option>
                    ) : null}

                    {responders.map((responder) => {
                      const responderName =
                        responder.user?.display_name?.trim() ||
                        [responder.user?.first_name, responder.user?.last_name]
                          .filter(Boolean)
                          .join(" ") ||
                        (responder.employee_number
                          ? `Responder ${responder.employee_number}`
                          : "Responder");

                      return (
                        <option key={responder.user_id} value={responder.user_id}>
                          {responder.employee_number
                            ? `${responderName} (${responder.employee_number})`
                            : responderName}
                        </option>
                      );
                    })}
                  </Select>
                </label>
              ) : null}

              <div className="rounded-lg bg-[#f5f8fa] p-3 text-xs text-[#71828d]">
                {assignmentType ===
                "team"
                  ? "The entire response team will be assigned to this emergency. No individual responder will be assigned."
                  : "Only the selected responder will be assigned to this emergency. No team will be assigned."}
              </div>
            </>
          ) : null}

          {/* ==================================================
              REROUTE
              ================================================== */}

          {sheet === "reroute" ? (
            <label>
              <FieldLabel>
                Destination organisation
              </FieldLabel>

              <Select
                value={
                  organisationId
                }
                onChange={(e) =>
                  setOrganisationId(
                    e.target.value
                  )
                }
                disabled={
                  assignmentLoading
                }
              >
                <option value="">
                  Select an organisation
                </option>

                {organisations.map(
                  (
                    organisation
                  ) => (
                    <option
                      key={
                        organisation.id
                      }
                      value={
                        organisation.id
                      }
                    >
                      {
                        organisation.name ||
                        organisation.id
                      }
                    </option>
                  )
                )}
              </Select>
            </label>
          ) : null}

          {/* ==================================================
              TEXT
              ================================================== */}

          {sheet !== "assign" ? (
            <label>
              <FieldLabel>
                {sheet ===
                "reject"
                  ? "Rejection reason"
                  : sheet ===
                    "reroute"
                  ? "Routing reason"
                  : "Operational note"}
              </FieldLabel>

              <Textarea
                value={text}
                onChange={(e) =>
                  setText(
                    e.target.value
                  )
                }
                placeholder="Enter clear operational information"
                disabled={assignmentLoading}
              />
            </label>
          ) : null}

          {/* ==================================================
              CONFIRM
              ================================================== */}

          <Button
            variant={
              sheet === "reject"
                ? "danger"
                : "primary"
            }
            size="lg"
            onClick={
              completeSheet
            }
            disabled={
              assignmentLoading ||
              (sheet === "assign"
                ? assignmentType ===
                  "team"
                  ? !teamId
                  : !responderId
                : sheet ===
                  "reroute"
                ? !organisationId ||
                  !text.trim()
                : !text.trim())
            }
          >
            {assignmentLoading
              ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              : <Send className="h-4 w-4" />}

            {assignmentLoading
              ? sheet === "assign"
                ? "Assigning..."
                : "Saving..."
              : sheet === "assign"
              ? assignmentType ===
                "team"
                ? "Assign team"
                : "Assign responder"
              : "Confirm action"}
          </Button>

        </div>
      </Sheet>
    </div>
  );
}

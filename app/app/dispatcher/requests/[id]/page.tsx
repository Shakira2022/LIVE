"use client";

import {
  Building2,
  MapPin,
  PhoneCall,
  Send,
  Siren,
} from "lucide-react";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
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
import { requestStatusTone } from "@/lib/utils";

export default function DispatchRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [sheet, setSheet] = useState<
    null | "assign" | "reroute" | "reject" | "note"
  >(null);

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

  const [request, setRequest] = useState<any>(null);

  const [requestLoading, setRequestLoading] =
    useState(true);

  const [responders, setResponders] =
    useState<any[]>([]);

  const [teams, setTeams] =
    useState<any[]>([]);

  const [organisations, setOrganisations] =
    useState<any[]>([]);

  const [assignment, setAssignment] =
    useState<any>(null);

  const [etaMinutes, setEtaMinutes] =
    useState("");

  // ==================================================
  // LOAD ALL REQUEST DATA
  // ==================================================

  async function loadRequestData() {
    try {
      setRequestLoading(true);

      const requestId = decodeURIComponent(id);

      console.log(
        "========== LOADING DISPATCH REQUEST =========="
      );

      console.log(
        "Loading emergency request:",
        requestId
      );

      // ==================================================
      // SUPABASE AUTH CHECK
      // ==================================================

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      console.log(
        "========== SUPABASE AUTH CHECK =========="
      );

      console.log(
        "SUPABASE SESSION:",
        session
      );

      console.log(
        "SUPABASE USER:",
        session?.user
      );

      console.log(
        "SUPABASE USER ID:",
        session?.user?.id
      );

      console.log(
        "SUPABASE SESSION ERROR:",
        sessionError
      );

      console.log(
        "SUPABASE ACCESS TOKEN EXISTS:",
        !!session?.access_token
      );

      // ==================================================
      // LOAD EMERGENCY REQUEST
      // ==================================================

      const {
        data: requestData,
        error: requestError,
      } = await supabase
        .from("emergency_requests")
        .select("*")
        .eq("id", requestId)
        .single();

      if (requestError) {
        console.error(
          "Failed to load emergency request:",
          requestError
        );

        setRequest(null);
        setAssignment(null);

        return;
      }

      console.log(
        "EMERGENCY REQUEST:",
        requestData
      );

      setRequest(requestData);

      // ==================================================
      // LOAD MOST RECENT ASSIGNMENT
      // ==================================================

      const {
        data: assignmentData,
        error: assignmentError,
      } = await supabase
        .from("request_assignments")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (assignmentError) {
        console.error(
          "Failed to load request assignment:",
          assignmentError
        );

        setAssignment(null);
      } else {
        console.log(
          "CURRENT ASSIGNMENT:",
          assignmentData
        );

        setAssignment(assignmentData);

        if (
          assignmentData?.eta_minutes !== null &&
          assignmentData?.eta_minutes !== undefined
        ) {
          setEtaMinutes(
            String(
              assignmentData.eta_minutes
            )
          );
        }
      }

      // ==================================================
      // LOAD AVAILABLE RESPONDERS
      // ==================================================

      const {
        data: responderData,
        error: responderError,
      } = await supabase
        .from("responder_profiles")
        .select("*")
        .eq("availability", "available");

      if (responderError) {
        console.error(
          "Failed to load available responders:",
          responderError
        );

        setResponders([]);
      } else {
        console.log(
          "AVAILABLE RESPONDERS:",
          responderData
        );

        setResponders(
          responderData || []
        );
      }

      // ==================================================
      // LOAD OPERATIONAL NOTES
      // ==================================================

      const {
        data: notesData,
        error: notesError,
      } = await supabase
        .from("operational_notes")
        .select("*")
        .eq("request_id", requestId)
        .is("deleted_at", null)
        .order("created_at", {
          ascending: false,
        });

      if (notesError) {
        console.error(
          "Failed to load operational notes:",
          notesError
        );

        setOperationalNotes([]);
      } else {
        console.log(
          "OPERATIONAL NOTES:",
          notesData
        );

        setOperationalNotes(
          notesData || []
        );
      }

      // ==================================================
      // LOAD AVAILABLE TEAMS
      // ==================================================

      const {
        data: teamData,
        error: teamError,
      } = await supabase
        .from("responder_teams")
        .select(`
          id,
          organisation_id,
          name,
          code,
          description,
          status
        `)
        .eq("status", "available")
        .order("name", {
          ascending: true,
        });

      if (teamError) {
        console.error(
          "Failed to load teams:",
          teamError
        );

        setTeams([]);
      } else {
        console.log(
          "ALL AVAILABLE TEAMS FROM SUPABASE:",
          teamData
        );

        setTeams(
          teamData || []
        );
      }

      // ==================================================
      // LOAD ORGANISATIONS
      // ==================================================

      const {
        data: organisationData,
        error: organisationError,
      } = await supabase
        .from("organisations")
        .select(`
          id,
          name,
          organisation_type,
          status
        `)
        .eq("status", "active")
        .order("name", {
          ascending: true,
        });

      if (organisationError) {
        console.error(
          "Failed to load organisations:",
          organisationError
        );

        setOrganisations([]);
      } else {
        console.log(
          "ALL ORGANISATIONS FROM SUPABASE:",
          organisationData
        );

        setOrganisations(
          organisationData || []
        );
      }

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

    if (assignment?.id) {
      alert(
        "This request already has an assignment."
      );

      return;
    }

    setAssignmentLoading(true);

    try {
      const now =
        new Date().toISOString();

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

      const {
        data: assignmentData,
        error: assignmentError,
      } = await supabase
        .from("request_assignments")
        .insert({
          request_id: request.id,
          organisation_id:
            selectedOrganisationId,
          team_id:
            assignmentType === "team"
              ? teamId
              : null,
          responder_user_id:
            assignmentType === "responder"
              ? responderId
              : null,
          assigned_by_user_id:
            user.id,
          status: "assigned",
          assigned_at: now,
        } as any)
        .select("*")
        .maybeSingle();

      if (assignmentError) {
        console.error(
          "Assignment insert failed:",
          assignmentError
        );

        alert(
          `Failed to create assignment: ${assignmentError.message}`
        );

        return;
      }

      if (!assignmentData) {
        alert(
          "The assignment could not be confirmed after being created."
        );

        return;
      }

      console.log(
        "ASSIGNMENT CREATED:",
        assignmentData
      );

      // ==================================================
      // UPDATE EMERGENCY REQUEST
      // ==================================================

      const {
        error: requestUpdateError,
      } = await supabase
        .from("emergency_requests")
        .update({
          current_status: "assigned",
          routed_organisation_id:
            selectedOrganisationId,
          assigned_at: now,
          updated_at: now,
        })
        .eq("id", request.id);

      if (requestUpdateError) {
        console.error(
          "Emergency request update failed:",
          requestUpdateError
        );

        alert(
          `Assignment was created, but the emergency request could not be updated: ${requestUpdateError.message}`
        );

        setAssignment(
          assignmentData
        );

        setSheet(null);
        setResponderId("");
        setTeamId("");

        return;
      }

      // ==================================================
      // UPDATE RESPONDER AVAILABILITY
      // ==================================================

      if (
        assignmentType === "responder"
      ) {
        const {
          error: responderAvailabilityError,
        } = await supabase
          .from("responder_profiles")
          .update({
            availability: "assigned",
            updated_at: now,
          })
          .eq(
            "user_id",
            responderId
          );

        if (
          responderAvailabilityError
        ) {
          console.error(
            "Failed to update responder availability:",
            responderAvailabilityError
          );
        }
      }

      // ==================================================
      // UPDATE TEAM STATUS
      // ==================================================

      if (
        assignmentType === "team"
      ) {
        const {
          error: teamStatusError,
        } = await supabase
          .from("responder_teams")
          .update({
            status: "assigned",
            updated_at: now,
          })
          .eq("id", teamId);

        if (teamStatusError) {
          console.error(
            "Failed to update team status:",
            teamStatusError
          );
        }
      }

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

      try {
        const accessToken =
          localStorage.getItem(
            "live-mock-access-token"
          );

        if (!accessToken) {
          alert(
            "Your session has expired. Please log in again."
          );

          return;
        }

        console.log(
          "OPERATIONAL NOTE",
          {
            requestId:
              request.id,
            note: text,
            dispatcherId:
              user?.id,
          }
        );

        const response =
          await fetch(
            "/api/operational-notes",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                Authorization:
                  `Bearer ${accessToken}`,
              },

              body: JSON.stringify({
                request_id:
                  request.id,

                note:
                  text.trim(),

                requester_visible:
                  false,
              }),
            }
          );

        const result =
          await response.json();

        if (
          !response.ok ||
          !result?.ok
        ) {
          console.error(
            "Failed to save operational note:",
            result
          );

          alert(
            result?.message ||
              "Failed to save operational note."
          );

          return;
        }

        console.log(
          "OPERATIONAL NOTE SAVED:",
          result.note
        );

        alert(
          "Operational note saved successfully."
        );

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

  const displayedStatus =
    assignment?.status ??
    request.current_status;

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
        description={`${request.category} · ${request.severity} priority`}
        action={
          <Badge
            tone={requestStatusTone(
              displayedStatus
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

        <LiveResponseMap
          request={request}
          immersive
        />

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

              {assignment?.status ===
              "en_route" ? (
                <Button
                  onClick={() =>
                    updateAssignmentStatus(
                      "arrived"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Mark arrived
                </Button>
              ) : null}

              {assignment?.status ===
              "arrived" ? (
                <Button
                  onClick={() =>
                    updateAssignmentStatus(
                      "completed"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Complete assignment
                </Button>
              ) : null}

              {assignment &&
              !terminalAssignment ? (
                <div className="sm:col-span-2">
                  <FieldLabel>
                    ETA (minutes)
                  </FieldLabel>

                  <div className="mt-2 flex gap-2">
                    <input
                      type="number"
                      min="0"
                      value={
                        etaMinutes
                      }
                      onChange={(
                        e
                      ) =>
                        setEtaMinutes(
                          e.target.value
                        )
                      }
                      placeholder="e.g. 15"
                      className="w-full rounded-lg border border-[#d7e0e7] px-3 py-2"
                    />

                    <Button
                      type="button"
                      onClick={
                        updateAssignmentEta
                      }
                      disabled={
                        assignmentLoading
                      }
                    >
                      Update ETA
                    </Button>
                  </div>
                </div>
              ) : null}

              {!terminalAssignment ? (
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

              {!terminalAssignment ? (
                <Button
                  variant="danger"
                  onClick={() =>
                    setSheet(
                      "reject"
                    )
                  }
                  disabled={
                    assignmentLoading
                  }
                >
                  Reject
                </Button>
              ) : null}

            </div>
          </Panel>

          {/* ==================================================
              REQUEST INFORMATION
              ================================================== */}

          <Panel>
            <PanelHeader title="Request information" />

            <dl className="divide-y divide-[#e2e8ed] text-sm">

              <div className="flex gap-3 p-4">
                <PhoneCall className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Requester
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {
                      request.requester_id
                    }
                  </dd>

                  <dd className="mt-1 text-[#617582]">
                    {
                      request.callback_number
                    }
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
                    Location data not available on this request.
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

      {/* ==================================================
          STATUS + NOTES
          ================================================== */}

      <div className="grid gap-4 lg:grid-cols-2">

        <Panel>
          <PanelHeader
            title="Status history"
          />

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
                        {new Date(
                          assignment.assigned_at
                        ).toLocaleString()}
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
                          {new Date(
                            assignment.acknowledged_at
                          ).toLocaleString()}
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
                          {new Date(
                            assignment.route_started_at
                          ).toLocaleString()}
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
                          {new Date(
                            assignment.arrived_at
                          ).toLocaleString()}
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
                          {new Date(
                            assignment.completed_at
                          ).toLocaleString()}
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
                          {new Date(
                            assignment.cancelled_at
                          ).toLocaleString()}
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
                          {new Date(
                            assignment.rejected_at
                          ).toLocaleString()}
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
                    {request.current_status.replace(
                      "_",
                      " "
                    )}
                  </p>
                </div>

              </div>
            )}

          </div>
        </Panel>

        {/* ==================================================
            OPERATIONAL NOTES
            ================================================== */}

        <Panel>
          <PanelHeader
            title="Operational notes"
          />

          {operationalNotes.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#71828d]">
              No operational notes available.
            </p>
          ) : (
            <div className="space-y-3 p-4">
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
                      {new Date(
                        note.created_at
                      ).toLocaleString()}
                    </p>
                  </div>
                )
              )}
            </div>
          )}
        </Panel>

      </div>

      {/* ==================================================
          ACTION SHEET
          ================================================== */}

      <Sheet
        open={
          sheet !== null
        }
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
                            ? ` · ${team.code}`
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

                    {responders.map(
                      (
                        responder
                      ) => (
                        <option
                          key={
                            responder.user_id
                          }
                          value={
                            responder.user_id
                          }
                        >
                          {
                            responder.employee_number
                          }

                          {" · "}

                          {
                            responder.qualification
                          }

                          {responder.license_number
                            ? ` · ${responder.license_number}`
                            : ""}
                        </option>
                      )
                    )}
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
            <Send className="h-4 w-4" />

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
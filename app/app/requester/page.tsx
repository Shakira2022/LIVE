"use client";

import {
  Building2,
  MapPin,
  PhoneCall,
  Send,
  Siren,
  UserRound,
  Ambulance,
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
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";

import { supabase } from "@/lib/supabase";
import { requestStatusTone } from "@/lib/utils";

/* ============================================================
   TYPES
   ============================================================ */

type ResponderProfile = {
  user_id: string;
  employee_number: string | null;
  qualification: string | null;
  license_number: string | null;
  organisation_id: string | null;
  availability: string | null;
};

type ResponderUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: string;
  status: string;
};

type ResponderOption = ResponderProfile & {
  user: ResponderUser | null;
};

type Assignment = {
  id: string;
  request_id: string;
  organisation_id: string;
  responder_user_id: string;
  assigned_by_user_id: string;
  status: string;
  eta_minutes: number | null;
  assigned_at: string | null;
  acknowledged_at: string | null;
  route_started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
};

const ACTIVE_ASSIGNMENT_STATUSES = [
  "assigned",
  "acknowledged",
  "en_route",
  "arrived",
];

/* ============================================================
   PAGE
   ============================================================ */

export default function DispatchRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { user } = useAuth();

  const [request, setRequest] =
    useState<any>(null);

  const [requestLoading, setRequestLoading] =
    useState(true);

  const [responders, setResponders] =
    useState<ResponderOption[]>([]);

  const [respondersLoading, setRespondersLoading] =
    useState(false);

  const [assignment, setAssignment] =
    useState<Assignment | null>(null);

  const [sheet, setSheet] =
    useState<
      null |
      "assign" |
      "reroute" |
      "reject" |
      "note"
    >(null);

  const [responderId, setResponderId] =
    useState("");

  const [organisationId, setOrganisationId] =
    useState("");

  const [text, setText] =
    useState("");

  const [etaMinutes, setEtaMinutes] =
    useState("");

  const [assignmentLoading, setAssignmentLoading] =
    useState(false);

  /* ============================================================
     LOAD REQUEST
     ============================================================ */

  useEffect(() => {
    if (!id) return;

    async function loadRequest() {
      try {
        setRequestLoading(true);

        const requestId =
          decodeURIComponent(id);

        console.log(
          "=========================================="
        );

        console.log(
          "LOADING DISPATCH REQUEST"
        );

        console.log(
          "REQUEST ID:",
          requestId
        );

        console.log(
          "=========================================="
        );

        /* --------------------------------------------------------
           LOAD EMERGENCY REQUEST
        -------------------------------------------------------- */

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
            "Emergency request error:",
            requestError
          );

          setRequest(null);
          return;
        }

        console.log(
          "EMERGENCY REQUEST:",
          requestData
        );

        setRequest(requestData);

        /* --------------------------------------------------------
           LOAD CURRENT ASSIGNMENT
        -------------------------------------------------------- */

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
            "Assignment lookup error:",
            assignmentError
          );

          setAssignment(null);
        } else {
          console.log(
            "CURRENT ASSIGNMENT:",
            assignmentData
          );

          setAssignment(
            assignmentData || null
          );
        }
      } catch (error) {
        console.error(
          "Request loading error:",
          error
        );

        setRequest(null);
      } finally {
        setRequestLoading(false);
      }
    }

    loadRequest();
  }, [id]);

  /* ============================================================
     LOAD AVAILABLE RESPONDERS
     
     IMPORTANT:
     responder_profiles.user_id is the actual responder's
     users.id.

     In your database:
     
     Samson:
     2d39d242-4897-4711-a672-adeba492add9
     role = requester

     Kabelo:
     00000000-0000-0000-0000-000000000003
     role = responder
     
     Therefore the assignment MUST use:
     
     00000000-0000-0000-0000-000000000003
     ============================================================ */

  async function loadResponders() {
    try {
      setRespondersLoading(true);

      console.log(
        "=========================================="
      );

      console.log(
        "LOADING AVAILABLE RESPONDERS"
      );

      console.log(
        "=========================================="
      );

      const {
        data: profiles,
        error: profileError,
      } = await supabase
        .from("responder_profiles")
        .select(
          `
            user_id,
            employee_number,
            qualification,
            license_number,
            organisation_id,
            availability
          `
        )
        .eq(
          "availability",
          "available"
        );

      if (profileError) {
        console.error(
          "Responder profile lookup failed:",
          profileError
        );

        setResponders([]);
        return;
      }

      console.log(
        "AVAILABLE RESPONDER PROFILES:",
        profiles
      );

      if (!profiles || profiles.length === 0) {
        setResponders([]);
        return;
      }

      /* --------------------------------------------------------
         Get the user IDs from responder_profiles
      -------------------------------------------------------- */

      const userIds =
        profiles.map(
          (profile) => profile.user_id
        );

      console.log(
        "RESPONDER USER IDS:",
        userIds
      );

      /* --------------------------------------------------------
         Load corresponding users
      -------------------------------------------------------- */

      const {
        data: users,
        error: usersError,
      } = await supabase
        .from("users")
        .select(
          `
            id,
            first_name,
            last_name,
            display_name,
            role,
            status
          `
        )
        .in("id", userIds);

      if (usersError) {
        console.error(
          "Responder users lookup failed:",
          usersError
        );
      }

      console.log(
        "RESPONDER USERS:",
        users
      );

      /* --------------------------------------------------------
         Combine responder profile + user
      -------------------------------------------------------- */

      const combined: ResponderOption[] =
        profiles
          .filter(
            (profile) => {
              const matchingUser =
                users?.find(
                  (u) =>
                    u.id ===
                    profile.user_id
                );

              /*
               * Extra protection:
               * only users whose role is actually
               * responder can appear here.
               */
              return (
                matchingUser?.role ===
                "responder"
              );
            }
          )
          .map((profile) => ({
            ...profile,
            user:
              users?.find(
                (u) =>
                  u.id ===
                  profile.user_id
              ) || null,
          }));

      console.log(
        "FINAL RESPONDER OPTIONS:",
        combined
      );

      setResponders(combined);
    } catch (error) {
      console.error(
        "Unexpected responder loading error:",
        error
      );

      setResponders([]);
    } finally {
      setRespondersLoading(false);
    }
  }

  useEffect(() => {
    loadResponders();
  }, []);

  /* ============================================================
     OPEN ASSIGN SHEET
     ============================================================ */

  function openAssignSheet() {
    setResponderId("");
    setSheet("assign");

    /*
     * Refresh the responder list whenever
     * dispatcher opens the assignment panel.
     */
    loadResponders();
  }

  /* ============================================================
     ASSIGN RESPONDER
     ============================================================ */

  async function assignResponder() {
    if (!request?.id) {
      alert(
        "Emergency request could not be found."
      );
      return;
    }

    if (!responderId) {
      alert(
        "Please select a responder."
      );
      return;
    }

    if (!user?.id) {
      alert(
        "Dispatcher authentication is required."
      );
      return;
    }

    try {
      setAssignmentLoading(true);

      console.log(
        "=========================================="
      );

      console.log(
        "CREATING RESPONDER ASSIGNMENT"
      );

      console.log(
        "REQUEST ID:",
        request.id
      );

      console.log(
        "SELECTED RESPONDER USER ID:",
        responderId
      );

      console.log(
        "DISPATCHER USER ID:",
        user.id
      );

      console.log(
        "=========================================="
      );

      /* --------------------------------------------------------
         Find selected responder profile
      -------------------------------------------------------- */

      const selectedResponder =
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

      console.log(
        "SELECTED RESPONDER:",
        selectedResponder
      );

      /* --------------------------------------------------------
         SAFETY CHECK
         
         Do NOT allow a requester to be assigned
         as a responder.
      -------------------------------------------------------- */

      if (
        selectedResponder.user?.role !==
        "responder"
      ) {
        alert(
          "The selected user is not a responder."
        );

        return;
      }

      /* --------------------------------------------------------
         Organisation is taken directly from
         responder_profiles.
      -------------------------------------------------------- */

      if (
        !selectedResponder.organisation_id
      ) {
        alert(
          "This responder is not linked to an organisation."
        );

        return;
      }

      /*
       * IMPORTANT:
       *
       * responderId MUST be:
       *
       * responder_profiles.user_id
       *
       * For Kabelo:
       *
       * 00000000-0000-0000-0000-000000000003
       */

      const responderUserId =
        selectedResponder.user_id;

      const responderOrganisationId =
        selectedResponder.organisation_id;

      console.log(
        "FINAL ASSIGNMENT VALUES:",
        {
          request_id: request.id,
          responder_user_id:
            responderUserId,
          organisation_id:
            responderOrganisationId,
          assigned_by_user_id:
            user.id,
        }
      );

      /* --------------------------------------------------------
         Prevent duplicate active assignment
      -------------------------------------------------------- */

      const {
        data: existingAssignment,
        error: existingError,
      } = await supabase
        .from("request_assignments")
        .select("id, status")
        .eq(
          "request_id",
          request.id
        )
        .in(
          "status",
          ACTIVE_ASSIGNMENT_STATUSES
        )
        .maybeSingle();

      if (existingError) {
        console.error(
          "Existing assignment check failed:",
          existingError
        );

        alert(
          existingError.message ||
            "Could not check existing assignment."
        );

        return;
      }

      if (existingAssignment) {
        alert(
          "This emergency request already has an active responder assignment."
        );

        setAssignment(
          existingAssignment as Assignment
        );

        return;
      }

      /* --------------------------------------------------------
         CREATE ASSIGNMENT
      -------------------------------------------------------- */

      const {
        data: newAssignment,
        error: assignmentError,
      } = await supabase
        .from("request_assignments")
        .insert({
          request_id:
            request.id,

          organisation_id:
            responderOrganisationId,

          responder_user_id:
            responderUserId,

          assigned_by_user_id:
            user.id,

          status:
            "assigned",

          assigned_at:
            new Date().toISOString(),
        })
        .select()
        .single();

      if (assignmentError) {
        console.error(
          "ASSIGNMENT INSERT ERROR:",
          assignmentError
        );

        alert(
          assignmentError.message ||
            "Failed to create responder assignment."
        );

        return;
      }

      console.log(
        "ASSIGNMENT CREATED:",
        newAssignment
      );

      /* --------------------------------------------------------
         Update responder availability
      -------------------------------------------------------- */

      const {
        error: availabilityError,
      } = await supabase
        .from("responder_profiles")
        .update({
          availability:
            "assigned",

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "user_id",
          responderUserId
        );

      if (availabilityError) {
        console.error(
          "Responder availability update failed:",
          availabilityError
        );

        alert(
          "Assignment was created, but responder availability could not be updated."
        );
      }

      /* --------------------------------------------------------
         Update emergency request
      -------------------------------------------------------- */

      const {
        error: requestUpdateError,
      } = await supabase
        .from("emergency_requests")
        .update({
          current_status:
            "assigned",

          routed_organisation_id:
            responderOrganisationId,

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          request.id
        );

      if (requestUpdateError) {
        console.error(
          "Emergency request update failed:",
          requestUpdateError
        );
      }

      /* --------------------------------------------------------
         Update local state
      -------------------------------------------------------- */

      setAssignment(
        newAssignment as Assignment
      );

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,

                current_status:
                  "assigned",

                routed_organisation_id:
                  responderOrganisationId,
              }
            : current
      );

      setResponders(
        (current) =>
          current.filter(
            (item) =>
              item.user_id !==
              responderUserId
          )
      );

      setResponderId("");
      setSheet(null);

      alert(
        "Responder assigned successfully."
      );
    } catch (error) {
      console.error(
        "Responder assignment error:",
        error
      );

      alert(
        "Unable to assign responder."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  /* ============================================================
     UPDATE ASSIGNMENT STATUS
     ============================================================ */

  async function updateAssignmentStatus(
    newStatus:
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

    try {
      setAssignmentLoading(true);

      const now =
        new Date().toISOString();

      const updates: any = {
        status: newStatus,
        updated_at: now,
      };

      if (
        newStatus ===
        "acknowledged"
      ) {
        updates.acknowledged_at =
          now;
      }

      if (
        newStatus ===
        "en_route"
      ) {
        updates.route_started_at =
          now;
      }

      if (
        newStatus ===
        "arrived"
      ) {
        updates.arrived_at =
          now;
      }

      if (
        newStatus ===
        "completed"
      ) {
        updates.completed_at =
          now;
      }

      if (
        newStatus ===
        "cancelled"
      ) {
        updates.cancelled_at =
          now;
      }

      if (
        newStatus ===
        "rejected"
      ) {
        updates.rejected_at =
          now;
      }

      const {
        error: updateError,
      } = await supabase
        .from("request_assignments")
        .update(updates)
        .eq(
          "id",
          assignment.id
        );

      if (updateError) {
        console.error(
          "Assignment status update failed:",
          updateError
        );

        alert(
          updateError.message ||
            "Failed to update assignment status."
        );

        return;
      }

      /* --------------------------------------------------------
         Determine request status
      -------------------------------------------------------- */

      let requestStatus =
        request?.current_status;

      if (
        newStatus ===
        "acknowledged"
      ) {
        requestStatus =
          "assigned";
      }

      if (
        newStatus ===
        "en_route"
      ) {
        requestStatus =
          "en_route";
      }

      if (
        newStatus ===
        "arrived"
      ) {
        requestStatus =
          "arrived";
      }

      if (
        newStatus ===
        "completed"
      ) {
        requestStatus =
          "closed";
      }

      if (
        newStatus ===
        "cancelled"
      ) {
        requestStatus =
          "cancelled";
      }

      if (
        newStatus ===
        "rejected"
      ) {
        requestStatus =
          "rejected";
      }

      /* --------------------------------------------------------
         Update emergency request
      -------------------------------------------------------- */

      const {
        error: requestError,
      } = await supabase
        .from("emergency_requests")
        .update({
          current_status:
            requestStatus,

          updated_at:
            now,
        })
        .eq(
          "id",
          assignment.request_id
        );

      if (requestError) {
        console.error(
          "Emergency request status update failed:",
          requestError
        );
      }

      /* --------------------------------------------------------
         Update responder availability
      -------------------------------------------------------- */

      let availability:
        | string
        | null = null;

      if (
        newStatus ===
        "en_route"
      ) {
        availability =
          "en_route";
      }

      if (
        newStatus ===
        "arrived"
      ) {
        availability =
          "on_scene";
      }

      if (
        newStatus ===
          "completed" ||
        newStatus ===
          "cancelled" ||
        newStatus ===
          "rejected"
      ) {
        availability =
          "available";
      }

      if (availability) {
        const {
          error:
            availabilityError,
        } = await supabase
          .from(
            "responder_profiles"
          )
          .update({
            availability,

            updated_at:
              now,
          })
          .eq(
            "user_id",
            assignment.responder_user_id
          );

        if (
          availabilityError
        ) {
          console.error(
            "Responder availability update failed:",
            availabilityError
          );
        }
      }

      /* --------------------------------------------------------
         Reload assignment
      -------------------------------------------------------- */

      const {
        data:
          updatedAssignment,
        error:
          reloadError,
      } = await supabase
        .from("request_assignments")
        .select("*")
        .eq(
          "id",
          assignment.id
        )
        .single();

      if (!reloadError) {
        setAssignment(
          updatedAssignment as Assignment
        );
      }

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,

                current_status:
                  requestStatus,
              }
            : current
      );

      alert(
        `Assignment status updated to ${newStatus}.`
      );
    } catch (error) {
      console.error(
        "Status update error:",
        error
      );

      alert(
        "Unable to update assignment status."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  /* ============================================================
     UPDATE ETA
     ============================================================ */

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

    try {
      setAssignmentLoading(true);

      const now =
        new Date().toISOString();

      const estimatedArrival =
        new Date(
          Date.now() +
            minutes *
              60 *
              1000
        ).toISOString();

      /* Assignment ETA */

      const {
        error: assignmentError,
      } = await supabase
        .from(
          "request_assignments"
        )
        .update({
          eta_minutes:
            minutes,

          updated_at:
            now,
        })
        .eq(
          "id",
          assignment.id
        );

      if (assignmentError) {
        console.error(
          "Assignment ETA update failed:",
          assignmentError
        );

        alert(
          assignmentError.message ||
            "Failed to update ETA."
        );

        return;
      }

      /* Emergency request ETA */

      const {
        error: requestError,
      } = await supabase
        .from("emergency_requests")
        .update({
          eta_minutes:
            minutes,

          estimated_arrival_at:
            estimatedArrival,

          updated_at:
            now,
        })
        .eq(
          "id",
          request.id
        );

      if (requestError) {
        console.error(
          "Request ETA update failed:",
          requestError
        );

        alert(
          requestError.message ||
            "Assignment ETA saved, but request ETA could not be updated."
        );

        return;
      }

      setAssignment(
        (current) =>
          current
            ? {
                ...current,
                eta_minutes:
                  minutes,
              }
            : current
      );

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,

                eta_minutes:
                  minutes,

                estimated_arrival_at:
                  estimatedArrival,
              }
            : current
      );

      setEtaMinutes("");

      alert(
        `ETA updated to ${minutes} minutes.`
      );
    } catch (error) {
      console.error(
        "ETA update error:",
        error
      );

      alert(
        "Unable to update ETA."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  /* ============================================================
     SHEET ACTION
     ============================================================ */

  async function completeSheet() {
    if (
      sheet ===
      "assign"
    ) {
      await assignResponder();
      return;
    }

    if (
      sheet ===
      "reroute"
    ) {
      if (
        !organisationId ||
        !text.trim()
      ) {
        alert(
          "Please select an organisation and provide a reason."
        );

        return;
      }

      alert(
        "Rerouting is not connected yet."
      );

      setSheet(null);
      setOrganisationId("");
      setText("");

      return;
    }

    if (
      sheet ===
      "reject"
    ) {
      if (!text.trim()) {
        alert(
          "Please provide a rejection reason."
        );

        return;
      }

      alert(
        "Rejection is not connected yet."
      );

      setSheet(null);
      setText("");

      return;
    }

    if (
      sheet ===
      "note"
    ) {
      if (!text.trim()) {
        alert(
          "Please enter an operational note."
        );

        return;
      }

      alert(
        "Operational notes are not connected yet."
      );

      setSheet(null);
      setText("");
    }
  }

  /* ============================================================
     LOADING
     ============================================================ */

  if (
    !user ||
    requestLoading
  ) {
    return (
      <PageSkeleton map />
    );
  }

  /* ============================================================
     REQUEST NOT FOUND
     ============================================================ */

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

  /* ============================================================
     RESPONDER DISPLAY NAME
     ============================================================ */

  const assignedResponder =
    assignment
      ? responders.find(
          (responder) =>
            responder.user_id ===
            assignment.responder_user_id
        )
      : null;

  /* ============================================================
     PAGE
     ============================================================ */

  return (
    <div className="app-page grid gap-5">

      {/* ========================================================
          HEADING
      ======================================================== */}

      <PageHeading
        eyebrow="Dispatch request"
        title={
          request.reference_code
        }
        description={`${request.category} · ${request.severity} priority`}
        action={
          <Badge
            tone={requestStatusTone(
              request.current_status
            )}
            className="min-h-9 px-4"
          >
            {request.current_status}
          </Badge>
        }
      />

      {/* ========================================================
          MAP + INFORMATION
      ======================================================== */}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">

        {/* MAP */}

        <LiveResponseMap
          request={request}
          immersive
        />

        {/* RIGHT SIDE */}

        <div className="grid content-start gap-4">

          {/* ====================================================
              OPERATIONAL ACTIONS
          ==================================================== */}

          <Panel>
            <PanelHeader
              title="Operational actions"
              description="Dispatcher controls for this emergency request."
            />

            <div className="grid gap-3 p-4 sm:grid-cols-2">

              {/* ASSIGN */}

              <Button
                variant="outline"
                onClick={
                  openAssignSheet
                }
                disabled={
                  !!assignment ||
                  respondersLoading
                }
              >
                <Ambulance className="h-4 w-4" />

                {assignment
                  ? "Responder assigned"
                  : respondersLoading
                  ? "Loading responders..."
                  : "Assign responder"}
              </Button>

              {/* ACKNOWLEDGE */}

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

              {/* EN ROUTE */}

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

              {/* ARRIVED */}

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

              {/* COMPLETED */}

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

              {/* ETA */}

              {assignment ? (
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
                        event
                      ) =>
                        setEtaMinutes(
                          event.target
                            .value
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

              {/* REROUTE */}

              <Button
                variant="outline"
                onClick={() =>
                  setSheet(
                    "reroute"
                  )
                }
              >
                Reroute
              </Button>

              {/* NOTE */}

              <Button
                variant="outline"
                onClick={() =>
                  setSheet("note")
                }
              >
                Add note
              </Button>

              {/* REJECT */}

              <Button
                variant="danger"
                onClick={() =>
                  setSheet(
                    "reject"
                  )
                }
              >
                Reject
              </Button>

            </div>
          </Panel>

          {/* ====================================================
              CURRENT ASSIGNMENT
          ==================================================== */}

          {assignment ? (
            <Panel>
              <PanelHeader
                title="Current responder"
              />

              <div className="divide-y divide-[#e2e8ed]">

                <div className="flex gap-3 p-4">
                  <UserRound className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Responder user ID
                    </p>

                    <p className="mt-1 break-all text-sm font-semibold">
                      {
                        assignment.responder_user_id
                      }
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4">
                  <Ambulance className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Assignment status
                    </p>

                    <p className="mt-1 font-semibold">
                      {
                        assignment.status
                      }
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4">
                  <Building2 className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Organisation
                    </p>

                    <p className="mt-1 break-all text-sm font-semibold">
                      {
                        assignment.organisation_id
                      }
                    </p>
                  </div>
                </div>

              </div>
            </Panel>
          ) : null}

          {/* ====================================================
              REQUEST INFORMATION
          ==================================================== */}

          <Panel>
            <PanelHeader title="Request information" />

            <dl className="divide-y divide-[#e2e8ed] text-sm">

              {/* REQUESTER */}

              <div className="flex gap-3 p-4">

                <PhoneCall className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Requester
                  </dt>

                  <dd className="mt-1 break-all font-semibold">
                    {
                      request.requester_id
                    }
                  </dd>

                  <dd className="mt-1 text-[#617582]">
                    {
                      request.callback_number ||
                      "No callback number"
                    }
                  </dd>
                </div>

              </div>

              {/* LOCATION */}

              <div className="flex gap-3 p-4">

                <MapPin className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Location
                  </dt>

                  <dd className="mt-1 text-[#71828d]">
                    Location is shown on the map.
                  </dd>
                </div>

              </div>

              {/* ROUTING */}

              <div className="flex gap-3 p-4">

                <Building2 className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Routing organisation
                  </dt>

                  <dd className="mt-1 break-all font-semibold">
                    {
                      request.routed_organisation_id ||
                      "Unassigned"
                    }
                  </dd>
                </div>

              </div>

              {/* INCIDENT */}

              <div className="flex gap-3 p-4">

                <Siren className="h-5 w-5 text-[#d53f3d]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Incident note
                  </dt>

                  <dd className="mt-1 leading-6">
                    {
                      request.note ||
                      "No incident note."
                    }
                  </dd>
                </div>

              </div>

            </dl>
          </Panel>

        </div>
      </div>

      {/* ========================================================
          STATUS + NOTES
      ======================================================== */}

      <div className="grid gap-4 lg:grid-cols-2">

        <Panel>
          <PanelHeader title="Status history" />

          <div className="p-5 text-sm text-[#71828d]">
            Current status:{" "}
            <span className="font-semibold text-[#102b3f]">
              {
                request.current_status
              }
            </span>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Operational notes" />

          <p className="p-8 text-center text-sm text-[#71828d]">
            No operational notes available.
          </p>
        </Panel>

      </div>

      {/* ========================================================
          ACTION SHEET
      ======================================================== */}

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
            setOrganisationId("");
          }
        }}
        title={
          sheet === "assign"
            ? "Assign a response unit"
            : sheet ===
              "reroute"
            ? "Reroute request"
            : sheet ===
              "reject"
            ? "Reject request"
            : "Add operational note"
        }
        description={
          request.reference_code
        }
      >

        <div className="grid gap-4 p-5">

          {/* ====================================================
              ASSIGN RESPONDER
          ==================================================== */}

          {sheet ===
          "assign" ? (
            <div className="grid gap-3">

              <label>
                <FieldLabel>
                  Available responder
                </FieldLabel>

                <Select
                  value={
                    responderId
                  }
                  onChange={(
                    event
                  ) =>
                    setResponderId(
                      event.target
                        .value
                    )
                  }
                  disabled={
                    assignmentLoading ||
                    respondersLoading
                  }
                >
                  <option value="">
                    {respondersLoading
                      ? "Loading responders..."
                      : "Select a responder"}
                  </option>

                  {responders.map(
                    (
                      responder
                    ) => {
                      const name =
                        responder
                          .user
                          ?.display_name ||
                        [
                          responder
                            .user
                            ?.first_name,
                          responder
                            .user
                            ?.last_name,
                        ]
                          .filter(
                            Boolean
                          )
                          .join(
                            " "
                          ) ||
                        "Unnamed responder";

                      return (
                        <option
                          key={
                            responder.user_id
                          }
                          value={
                            responder.user_id
                          }
                        >
                          {name}
                          {" · "}
                          {responder.employee_number ||
                            "No employee number"}
                        </option>
                      );
                    }
                  )}
                </Select>
              </label>

              {/* DEBUG INFORMATION */}

              {responderId ? (
                <div className="rounded-xl border border-[#d7e0e7] bg-[#f7fafb] p-4 text-xs">

                  <p className="font-bold uppercase tracking-wide text-[#748693]">
                    Selected responder ID
                  </p>

                  <p className="mt-1 break-all font-mono text-[#102b3f]">
                    {
                      responderId
                    }
                  </p>

                  <p className="mt-3 font-bold uppercase tracking-wide text-[#748693]">
                    Organisation ID
                  </p>

                  <p className="mt-1 break-all font-mono text-[#102b3f]">
                    {
                      responders.find(
                        (item) =>
                          item.user_id ===
                          responderId
                      )
                        ?.organisation_id ||
                      "Not linked"
                    }
                  </p>

                </div>
              ) : null}

            </div>
          ) : null}

          {/* ====================================================
              REROUTE
          ==================================================== */}

          {sheet ===
          "reroute" ? (
            <label>
              <FieldLabel>
                Destination organisation
              </FieldLabel>

              <Select
                value={
                  organisationId
                }
                onChange={(
                  event
                ) =>
                  setOrganisationId(
                    event.target
                      .value
                  )
                }
              >
                <option value="">
                  Select an organisation
                </option>
              </Select>
            </label>
          ) : null}

          {/* ====================================================
              TEXT
          ==================================================== */}

          {sheet !==
          "assign" ? (
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
                onChange={(
                  event
                ) =>
                  setText(
                    event.target
                      .value
                  )
                }
                placeholder="Enter clear operational information"
              />
            </label>
          ) : null}

          {/* ====================================================
              CONFIRM
          ==================================================== */}

          <Button
            variant={
              sheet ===
              "reject"
                ? "danger"
                : "primary"
            }
            size="lg"
            onClick={
              completeSheet
            }
            disabled={
              assignmentLoading ||
              (sheet ===
              "assign"
                ? !responderId
                : sheet ===
                  "reroute"
                ? !organisationId ||
                  !text.trim()
                : !text.trim())
            }
          >
            <Send className="h-4 w-4" />

            {assignmentLoading
              ? "Processing..."
              : sheet ===
                "assign"
              ? "Assign responder"
              : "Confirm action"}
          </Button>

        </div>

      </Sheet>

    </div>
  );
}
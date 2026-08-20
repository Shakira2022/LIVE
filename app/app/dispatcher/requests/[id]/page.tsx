"use client";

import {
  Ambulance,
  Ban,
  Building2,
  CheckCircle2,
  MapPin,
  MessageSquareText,
  Navigation,
  Send,
  Siren,
  Route,
  PhoneCall,
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

export default function DispatchRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [request, setRequest] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);

  const [responders, setResponders] = useState<any[]>([]);
  const [assignment, setAssignment] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [assignmentLoading, setAssignmentLoading] =
    useState(false);

  const [sheet, setSheet] = useState<
    null | "assign" | "reroute" | "reject" | "note"
  >(null);

  const [responderId, setResponderId] = useState("");
  const [text, setText] = useState("");

  // =====================================================
  // LOAD DATA
  // =====================================================

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);

        const requestId = decodeURIComponent(id);

        console.log(
          "=========================================="
        );
        console.log("DISPATCHER REQUEST DETAIL");
        console.log("REQUEST ID:", requestId);
        console.log(
          "=========================================="
        );

        // =================================================
        // LOAD EMERGENCY REQUEST
        // =================================================

        let requestData: any = null;
        let requestError: any = null;

        const uuidResult = await supabase
          .from("emergency_requests")
          .select("*")
          .eq("id", requestId)
          .maybeSingle();

        requestData = uuidResult.data;
        requestError = uuidResult.error;

        // Try reference code if UUID was not found
        if (!requestData && !requestError) {
          const referenceResult = await supabase
            .from("emergency_requests")
            .select("*")
            .eq("reference_code", requestId)
            .maybeSingle();

          requestData = referenceResult.data;
          requestError = referenceResult.error;
        }

        if (requestError) {
          console.error(
            "Failed to load emergency request:",
            requestError
          );

          setRequest(null);
          return;
        }

        if (!requestData) {
          console.error(
            "Emergency request not found:",
            requestId
          );

          setRequest(null);
          return;
        }

        console.log(
          "EMERGENCY REQUEST:",
          requestData
        );

        setRequest(requestData);

        const realRequestId = requestData.id;

        // =================================================
        // LOAD LOCATION
        // =================================================

        const {
          data: locationData,
          error: locationError,
        } = await supabase
          .from("request_locations")
          .select("*")
          .eq("request_id", realRequestId)
          .maybeSingle();

        if (locationError) {
          console.error(
            "Failed to load request location:",
            locationError
          );
        }

        setLocation(locationData);

        // =================================================
        // LOAD CURRENT ASSIGNMENT
        // =================================================

        const {
          data: assignmentData,
          error: assignmentError,
        } = await supabase
          .from("request_assignments")
          .select("*")
          .eq("request_id", realRequestId)
          .order("created_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

        if (assignmentError) {
          console.error(
            "Failed to load assignment:",
            assignmentError
          );
        }

        console.log(
          "CURRENT ASSIGNMENT:",
          assignmentData
        );

        setAssignment(assignmentData);

        // =================================================
        // LOAD ALL RESPONDER USERS
        // =================================================

        const {
          data: responderUsers,
          error: responderUsersError,
        } = await supabase
          .from("users")
          .select(`
            id,
            first_name,
            last_name,
            display_name,
            email,
            role,
            status
          `)
          .eq("role", "responder");

        if (responderUsersError) {
          console.error(
            "Failed to load responder users:",
            responderUsersError
          );

          setResponders([]);
          return;
        }

        console.log(
          "RESPONDER USERS:",
          responderUsers
        );

        if (
          !responderUsers ||
          responderUsers.length === 0
        ) {
          console.warn(
            "No responder users found."
          );

          setResponders([]);
          return;
        }

        // =================================================
        // GET RESPONDER USER IDS
        // =================================================

        const responderUserIds =
          responderUsers
            .map(
              (responder) =>
                responder.id
            )
            .filter(Boolean);

        // =================================================
        // LOAD RESPONDER PROFILES
        // =================================================

        const {
          data: responderProfiles,
          error: responderProfilesError,
        } = await supabase
          .from("responder_profiles")
          .select(`
            user_id,
            organisation_id,
            employee_number,
            qualification,
            license_number,
            availability
          `)
          .in(
            "user_id",
            responderUserIds
          );

        if (responderProfilesError) {
          console.error(
            "Failed to load responder profiles:",
            responderProfilesError
          );

          setResponders([]);
          return;
        }

        console.log(
          "RESPONDER PROFILES:",
          responderProfiles
        );

        // =================================================
        // COMBINE USERS + PROFILES
        //
        // IMPORTANT:
        // We do NOT filter availability.
        //
        // Everyone stays in the list:
        // available
        // assigned
        // en_route
        // on_scene
        // unavailable
        // =================================================

        const combinedResponders =
          (responderUsers || [])
            .map((responderUser) => {
              const profile =
                (responderProfiles || []).find(
                  (p) =>
                    p.user_id ===
                    responderUser.id
                );

              const displayName =
                responderUser.display_name ||
                `${responderUser.first_name || ""} ${
                  responderUser.last_name || ""
                }`.trim();

              return {
                id: responderUser.id,

                user_id:
                  responderUser.id,

                first_name:
                  responderUser.first_name ||
                  "",

                last_name:
                  responderUser.last_name ||
                  "",

                display_name:
                  displayName ||
                  "Responder",

                email:
                  responderUser.email ||
                  "",

                role:
                  responderUser.role,

                user_status:
                  responderUser.status ||
                  "unknown",

                organisation_id:
                  profile?.organisation_id ||
                  null,

                employee_number:
                  profile?.employee_number ||
                  "",

                qualification:
                  profile?.qualification ||
                  "",

                license_number:
                  profile?.license_number ||
                  "",

                availability:
                  profile?.availability ||
                  "unknown",
              };
            });

        console.log(
          "ALL COMBINED RESPONDERS:",
          combinedResponders
        );

        // =================================================
        // IMPORTANT:
        //
        // DO NOT FILTER THIS LIST.
        //
        // Assigned responders stay visible.
        // En-route responders stay visible.
        // On-scene responders stay visible.
        // Available responders stay visible.
        // =================================================

        setResponders(
          combinedResponders
        );
      } catch (error) {
        console.error(
          "Unexpected dispatcher loading error:",
          error
        );

        setRequest(null);
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      loadData();
    }
  }, [id]);

  // =====================================================
  // ASSIGN RESPONDER
  // =====================================================

  async function assignResponder() {
    if (!responderId) {
      alert(
        "Please select a responder."
      );
      return;
    }

    if (!user?.id) {
      alert(
        "Dispatcher authentication is missing."
      );
      return;
    }

    if (!request?.id) {
      alert(
        "Emergency request ID is missing."
      );
      return;
    }

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

    if (
      !selectedResponder.organisation_id
    ) {
      alert(
        "Selected responder is not linked to an organisation."
      );
      return;
    }

    // =================================================
    // ONLY AVAILABLE RESPONDERS CAN BE ASSIGNED
    // =================================================

    const availability =
      String(
        selectedResponder.availability ||
          ""
      ).toLowerCase();

    if (availability !== "available") {
      alert(
        `This responder is currently ${availability || "unavailable"}. Please select an available responder.`
      );

      return;
    }

    try {
      setAssignmentLoading(true);

      console.log(
        "=========================================="
      );

      console.log(
        "ASSIGNING RESPONDER"
      );

      console.log(
        "RESPONDER:",
        selectedResponder
      );

      console.log(
        "REQUEST:",
        request.id
      );

      console.log(
        "DISPATCHER:",
        user.id
      );

      console.log(
        "=========================================="
      );

      // =================================================
      // CREATE ASSIGNMENT THROUGH API
      // =================================================

      const response = await fetch(
        `/api/emergency-requests/${encodeURIComponent(
          request.reference_code ||
            request.id
        )}/assignments`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            organisation_id:
              selectedResponder.organisation_id,

            responder_user_id:
              selectedResponder.user_id,

            assigned_by_user_id:
              user.id,
          }),
        }
      );

      const result =
        await response.json();

      console.log(
        "ASSIGNMENT API RESPONSE:",
        result
      );

      if (!response.ok) {
        alert(
          result?.message ||
            "Failed to assign responder."
        );

        return;
      }

      console.log(
        "ASSIGNMENT CREATED:",
        result.assignment
      );

      // =================================================
      // SAVE ASSIGNMENT LOCALLY
      // =================================================

      setAssignment(
        result.assignment
      );

      // =================================================
      // UPDATE REQUEST STATUS LOCALLY
      // =================================================

      setRequest(
        (current: any) =>
          current
            ? {
                ...current,

                current_status:
                  "assigned",

                assigned_at:
                  new Date().toISOString(),
              }
            : current
      );

      // =================================================
      // KEEP RESPONDER IN DROPDOWN
      //
      // Just change their availability locally.
      // =================================================

      setResponders(
        (current) =>
          current.map(
            (responder) =>
              responder.user_id ===
              selectedResponder.user_id
                ? {
                    ...responder,
                    availability:
                      "assigned",
                  }
                : responder
          )
      );

      setSheet(null);
      setResponderId("");

      alert(
        `${
          selectedResponder.display_name ||
          "Responder"
        } assigned successfully.`
      );
    } catch (error) {
      console.error(
        "Unexpected assignment error:",
        error
      );

      alert(
        "Could not connect to the assignment API."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  // =====================================================
  // UPDATE ASSIGNMENT STATUS
  // =====================================================

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
        "No responder assignment exists."
      );
      return;
    }

    if (!request?.id) {
      alert(
        "Emergency request ID is missing."
      );
      return;
    }

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
      newStatus === "en_route"
    ) {
      updates.route_started_at =
        now;
    }

    if (
      newStatus === "arrived"
    ) {
      updates.arrived_at =
        now;
    }

    if (
      newStatus === "completed"
    ) {
      updates.completed_at =
        now;
    }

    if (
      newStatus === "cancelled"
    ) {
      updates.cancelled_at =
        now;
    }

    if (
      newStatus === "rejected"
    ) {
      updates.rejected_at =
        now;
    }

    // =================================================
    // UPDATE ASSIGNMENT
    // =================================================

    const {
      error: assignmentError,
    } = await supabase
      .from("request_assignments")
      .update(updates)
      .eq(
        "id",
        assignment.id
      );

    if (assignmentError) {
      console.error(
        "Failed to update assignment:",
        assignmentError
      );

      alert(
        assignmentError.message ||
          "Failed to update assignment."
      );

      return;
    }

    // =================================================
    // DETERMINE REQUEST STATUS
    // =================================================

    let requestStatus =
      request.current_status;

    if (
      newStatus ===
      "acknowledged"
    ) {
      requestStatus =
        "assigned";
    }

    if (
      newStatus === "en_route"
    ) {
      requestStatus =
        "en_route";
    }

    if (
      newStatus === "arrived"
    ) {
      requestStatus =
        "arrived";
    }

    if (
      newStatus === "completed"
    ) {
      requestStatus =
        "closed";
    }

    if (
      newStatus === "cancelled"
    ) {
      requestStatus =
        "cancelled";
    }

    if (
      newStatus === "rejected"
    ) {
      requestStatus =
        "rejected";
    }

    // =================================================
    // UPDATE EMERGENCY REQUEST
    // =================================================

    const {
      error: requestError,
    } = await supabase
      .from("emergency_requests")
      .update({
        current_status:
          requestStatus,
        updated_at: now,
      })
      .eq(
        "id",
        request.id
      );

    if (requestError) {
      console.error(
        "Failed to update request status:",
        requestError
      );

      alert(
        "Assignment updated, but emergency request status could not be updated."
      );

      return;
    }

    // =================================================
    // DETERMINE RESPONDER AVAILABILITY
    // =================================================

    let availability =
      "assigned";

    if (
      newStatus === "en_route"
    ) {
      availability =
        "en_route";
    }

    if (
      newStatus === "arrived"
    ) {
      availability =
        "on_scene";
    }

    // When the assignment is finished,
    // the responder becomes available again.

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

    // =================================================
    // UPDATE RESPONDER PROFILE
    // =================================================

    if (
      assignment.responder_user_id
    ) {
      const {
        error: responderError,
      } = await supabase
        .from("responder_profiles")
        .update({
          availability:
            availability,

          updated_at:
            now,
        })
        .eq(
          "user_id",
          assignment.responder_user_id
        );

      if (responderError) {
        console.error(
          "Failed to update responder availability:",
          responderError
        );

        alert(
          "Assignment status updated, but responder availability could not be updated."
        );
      }
    }

    // =================================================
    // UPDATE LOCAL ASSIGNMENT
    // =================================================

    setAssignment(
      (current: any) =>
        current
          ? {
              ...current,
              ...updates,
            }
          : current
    );

    // =================================================
    // UPDATE LOCAL REQUEST
    // =================================================

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

    // =================================================
    // KEEP RESPONDER IN DROPDOWN
    // =================================================

    setResponders(
      (current) =>
        current.map(
          (responder) =>
            responder.user_id ===
            assignment.responder_user_id
              ? {
                  ...responder,

                  availability:
                    availability,
                }
              : responder
        )
    );

    alert(
      `Assignment updated to ${newStatus}.`
    );
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading || !user) {
    return (
      <PageSkeleton map />
    );
  }

  // =====================================================
  // REQUEST NOT FOUND
  // =====================================================

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

  // =====================================================
  // FIND CURRENT RESPONDER
  // =====================================================

  const currentResponder =
    assignment?.responder_user_id
      ? responders.find(
          (responder) =>
            responder.user_id ===
            assignment.responder_user_id
        )
      : null;

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <div className="app-page grid gap-5">

      <PageHeading
        eyebrow="Dispatch request"
        title={
          request.reference_code ||
          request.id
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

      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">

        {/* =================================================
            MAP
        ================================================= */}

        <LiveResponseMap
          request={{
            ...request,

            location: {
              address:
                location?.address_text ||
                location?.landmark ||
                "Location not available",

              latitude:
                location?.latitude ??
                0,

              longitude:
                location?.longitude ??
                0,
            },
          }}
          immersive
        />

        <div className="grid content-start gap-4">

          {/* =================================================
              OPERATIONAL ACTIONS
          ================================================= */}

          <Panel>
            <PanelHeader
              title="Operational actions"
              description="Dispatcher controls for this emergency request."
            />

            <div className="grid gap-2 p-4 sm:grid-cols-2">

              {!assignment ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() =>
                    setSheet("assign")
                  }
                >
                  <Ambulance className="h-4 w-4" />
                  Assign responder
                </Button>
              ) : null}

              {assignment?.status ===
              "assigned" ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() =>
                    updateAssignmentStatus(
                      "acknowledged"
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Acknowledge assignment
                </Button>
              ) : null}

              {assignment?.status ===
              "acknowledged" ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() =>
                    updateAssignmentStatus(
                      "en_route"
                    )
                  }
                >
                  <Navigation className="h-4 w-4" />
                  Start route
                </Button>
              ) : null}

              {assignment?.status ===
              "en_route" ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() =>
                    updateAssignmentStatus(
                      "arrived"
                    )
                  }
                >
                  <MapPin className="h-4 w-4" />
                  Mark arrived
                </Button>
              ) : null}

              {assignment?.status ===
              "arrived" ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() =>
                    updateAssignmentStatus(
                      "completed"
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Complete assignment
                </Button>
              ) : null}

              <Button
                variant="outline"
                onClick={() =>
                  setSheet("reroute")
                }
              >
                <Route className="h-4 w-4" />
                Reroute
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  setSheet("note")
                }
              >
                <MessageSquareText className="h-4 w-4" />
                Add note
              </Button>

              <Button
                variant="danger"
                onClick={() =>
                  setSheet("reject")
                }
                disabled={[
                  "closed",
                  "cancelled",
                  "rejected",
                ].includes(
                  request.current_status
                )}
              >
                <Ban className="h-4 w-4" />
                Reject
              </Button>

            </div>
          </Panel>

          {/* =================================================
              REQUEST INFORMATION
          ================================================= */}

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

                  <dd className="mt-1 font-semibold">
                    {request.requester_id ||
                      "Unknown requester"}
                  </dd>

                  <dd className="mt-1 text-[#617582]">
                    {request.callback_number ||
                      "No callback number"}
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

                  <dd className="mt-1 font-semibold">
                    {location?.address_text ||
                      location?.landmark ||
                      "Location not available"}
                  </dd>

                  {location ? (
                    <dd className="mt-1 text-xs text-[#71828d]">
                      {location.latitude},{" "}
                      {location.longitude}
                    </dd>
                  ) : null}
                </div>
              </div>

              {/* RESPONDER */}

              <div className="flex gap-3 p-4">
                <Building2 className="h-5 w-5 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                    Responder
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {currentResponder?.display_name ||
                      assignment?.responder_user_id ||
                      "No responder assigned"}
                  </dd>

                  {currentResponder ? (
                    <dd className="mt-1 text-xs text-[#71828d]">
                      {currentResponder.employee_number
                        ? `Employee: ${currentResponder.employee_number}`
                        : "Responder"}
                      {" · "}
                      {String(
                        currentResponder.availability ||
                          "unknown"
                      ).toUpperCase()}
                    </dd>
                  ) : null}

                  <dd className="mt-1 text-xs text-[#71828d]">
                    {assignment
                      ? `Assignment: ${assignment.status}`
                      : "Awaiting assignment"}
                  </dd>
                </div>
              </div>

              {/* INCIDENT NOTE */}

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

      {/* =====================================================
          CURRENT ASSIGNMENT STATUS
      ===================================================== */}

      <Panel>
        <PanelHeader title="Current assignment status" />

        <div className="p-5 text-sm text-[#71828d]">

          Emergency status:{" "}

          <span className="font-semibold text-[#102b3f]">
            {request.current_status}
          </span>

          {assignment ? (
            <>
              {" · "}

              Assignment:{" "}

              <span className="font-semibold text-[#102b3f]">
                {assignment.status}
              </span>
            </>
          ) : null}

        </div>
      </Panel>

      {/* =====================================================
          ACTION SHEET
      ===================================================== */}

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSheet(null);
            setText("");
          }
        }}
        title={
          sheet === "assign"
            ? "Assign a response unit"
            : sheet === "reroute"
              ? "Reroute request"
              : sheet === "reject"
                ? "Reject request"
                : "Add operational note"
        }
        description={
          request.reference_code ||
          request.id
        }
      >

        <div className="grid gap-4 p-5">

          {/* =================================================
              ASSIGN RESPONDER
          ================================================= */}

          {sheet === "assign" ? (
            <label>

              <FieldLabel>
                Responder
              </FieldLabel>

              <Select
                value={responderId}
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
                  Select a responder
                </option>

                {responders.map(
                  (responder) => {

                    const availability =
                      String(
                        responder.availability ||
                          "unknown"
                      ).toLowerCase();

                    const isAvailable =
                      availability ===
                      "available";

                    const isActive =
                      responder.user_status ===
                      "active";

                    const canAssign =
                      isAvailable &&
                      isActive &&
                      !!responder.organisation_id;

                    return (
                      <option
                        key={
                          responder.user_id
                        }
                        value={
                          responder.user_id
                        }
                        disabled={
                          !canAssign
                        }
                      >

                        {responder.display_name ||
                          "Responder"}

                        {" · "}

                        {responder.employee_number ||
                          "No employee number"}

                        {" · "}

                        {responder.qualification ||
                          "Responder"}

                        {" · "}

                        {availability.toUpperCase()}

                        {!responder.organisation_id
                          ? " · NO ORGANISATION"
                          : ""}

                        {!isActive
                          ? " · INACTIVE"
                          : ""}

                      </option>
                    );
                  }
                )}

              </Select>

              {responders.length ===
              0 ? (
                <p className="mt-2 text-sm text-red-500">
                  No responder users were found.
                  .
                </p>
              ) : (
                <p className="mt-2 text-xs text-[#71828d]">
                  {responders.length} responder
                  {responders.length !== 1
                    ? "s"
                    : ""}{" "}
                  found. Available responders
                  can be assigned. Busy responders
                  remain visible but cannot be
                  selected.
                </p>
              )}

            </label>
          ) : null}

          {/* =================================================
              REROUTE
          ================================================= */}

          {sheet === "reroute" ? (
            <label>

              <FieldLabel>
                Routing reason'
              </FieldLabel>

              <Textarea
                value={text}
                onChange={(e) =>
                  setText(
                    e.target.value
                  )
                }
                placeholder="Enter routing reason"
              />

            </label>
          ) : null}

          {/* =================================================
              REJECT
          ================================================= */}

          {sheet === "reject" ? (
            <label>

              <FieldLabel>
                Rejection reason
              </FieldLabel>

              <Textarea
                value={text}
                onChange={(e) =>
                  setText(
                    e.target.value
                  )
                }
                placeholder="Enter rejection reason"
              />

            </label>
          ) : null}

          {/* =================================================
              NOTE
          ================================================= */}

          {sheet === "note" ? (
            <label>

              <FieldLabel>
                Operational note
              </FieldLabel>

              <Textarea
                value={text}
                onChange={(e) =>
                  setText(
                    e.target.value
                  )
                }
                placeholder="Enter operational information"
              />

            </label>
          ) : null}

          {/* =================================================
              CONFIRM BUTTON
          ================================================= */}

          <Button
            variant={
              sheet === "reject"
                ? "danger"
                : "primary"
            }
            size="lg"
            onClick={
              sheet === "assign"
                ? assignResponder
                : () => {
                    alert(
                      "This action will be connected next."
                    );
                  }
            }
            disabled={
              assignmentLoading ||
              (sheet === "assign"
                ? !responderId
                : !text.trim())
            }
          >

            <Send className="h-4 w-4" />

            {assignmentLoading
              ? "Assigning..."
              : "Confirm action"}

          </Button>

        </div>
      </Sheet>

    </div>
  );
}
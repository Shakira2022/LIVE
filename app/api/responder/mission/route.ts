import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseServer } from "@/lib/supabase-server";
import { verifyAccessToken } from "@/lib/auth/jwt";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "assigned",
  "acknowledged",
  "en_route",
  "arrived",
] as const;

const ALLOWED_STATUS_TRANSITIONS = {
  assigned: "acknowledged",
  acknowledged: "en_route",
  en_route: "arrived",
  arrived: "completed",
} as const;

async function getAuthenticatedUser() {
  const cookieStore = await cookies();

  const token =
    cookieStore.get("access_token")?.value;

  if (!token) {
    return null;
  }

  const payload =
    await verifyAccessToken(token);

  if (!payload) {
    return null;
  }

  return payload;
}

// ============================================================
// GET CURRENT RESPONDER MISSION
// ============================================================

export async function GET() {
  try {
    const authUser =
      await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Authentication required.",
        },
        { status: 401 }
      );
    }

    if (authUser.role !== "responder") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Only responders can access the responder mission.",
        },
        { status: 403 }
      );
    }

    console.log(
      "=========================================="
    );

    console.log(
      "LOADING RESPONDER MISSION"
    );

    console.log(
      "RESPONDER USER:",
      authUser.userId
    );

    console.log(
      "=========================================="
    );

    // ==========================================================
    // FIND ACTIVE ASSIGNMENT
    // ==========================================================

    const {
      data: assignment,
      error: assignmentError,
    } =
      await supabaseServer
        .from("request_assignments")
        .select("*")
        .eq(
          "responder_user_id",
          authUser.userId
        )
        .in(
          "status",
          ACTIVE_ASSIGNMENT_STATUSES
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (assignmentError) {
      console.error(
        "Responder assignment lookup failed:",
        assignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to load responder assignment.",
        },
        { status: 500 }
      );
    }

    // No active assignment is perfectly valid.
    if (!assignment) {
      console.log(
        "RESPONDER HAS NO ACTIVE ASSIGNMENT"
      );

      return NextResponse.json(
        {
          ok: true,
          mission: null,
        },
        { status: 200 }
      );
    }

    console.log(
      "ACTIVE ASSIGNMENT:",
      assignment
    );

    // ==========================================================
    // LOAD EMERGENCY REQUEST
    // ==========================================================

    const {
      data: emergencyRequest,
      error: requestError,
    } =
      await supabaseServer
        .from("emergency_requests")
        .select("*")
        .eq(
          "id",
          assignment.request_id
        )
        .maybeSingle();

    if (requestError) {
      console.error(
        "Emergency request lookup failed:",
        requestError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to load emergency request.",
        },
        { status: 500 }
      );
    }

    if (!emergencyRequest) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "The assigned emergency request could not be found.",
        },
        { status: 404 }
      );
    }

    // ==========================================================
    // LOAD LOCATION
    // ==========================================================

    const {
      data: location,
      error: locationError,
    } =
      await supabaseServer
        .from("request_locations")
        .select("*")
        .eq(
          "request_id",
          emergencyRequest.id
        )
        .maybeSingle();

    if (locationError) {
      console.error(
        "Request location lookup failed:",
        locationError
      );
    }

    // ==========================================================
    // LOAD STATUS HISTORY
    // ==========================================================

    const {
      data: statusHistory,
      error: historyError,
    } =
      await supabaseServer
        .from("request_status_history")
        .select("*")
        .eq(
          "request_id",
          emergencyRequest.id
        )
        .order("created_at", {
          ascending: true,
        });

    if (historyError) {
      console.error(
        "Status history lookup failed:",
        historyError
      );
    }

    // ==========================================================
    // LOAD RESPONDER PROFILE
    // ==========================================================

    const {
      data: responder,
      error: responderError,
    } =
      await supabaseServer
        .from("responder_profiles")
        .select(
          "user_id, availability"
        )
        .eq(
          "user_id",
          authUser.userId
        )
        .maybeSingle();

    if (responderError) {
      console.error(
        "Responder profile lookup failed:",
        responderError
      );
    }

    return NextResponse.json(
      {
        ok: true,

        mission: {
          assignment,

          request:
            emergencyRequest,

          location:
            location || null,

          statusHistory:
            statusHistory || [],

          responder:
            responder || null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Responder mission GET error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to load responder mission.",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// UPDATE RESPONDER MISSION
// ============================================================

export async function PATCH(
  request: Request
) {
  try {
    const authUser =
      await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Authentication required.",
        },
        { status: 401 }
      );
    }

    if (authUser.role !== "responder") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Only responders can update responder missions.",
        },
        { status: 403 }
      );
    }

    const body =
      await request.json();

    const {
      assignment_id,
      status,
    } = body;

    if (!assignment_id) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "assignment_id is required.",
        },
        { status: 400 }
      );
    }

    if (
      ![
        "acknowledged",
        "en_route",
        "arrived",
        "completed",
      ].includes(status)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Invalid responder status.",
        },
        { status: 400 }
      );
    }

    // ==========================================================
    // FIND ASSIGNMENT BELONGING TO THIS RESPONDER
    // ==========================================================

    const {
      data: assignment,
      error: assignmentError,
    } =
      await supabaseServer
        .from("request_assignments")
        .select("*")
        .eq("id", assignment_id)
        .eq(
          "responder_user_id",
          authUser.userId
        )
        .maybeSingle();

    if (assignmentError) {
      console.error(
        "Assignment verification failed:",
        assignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to verify assignment.",
        },
        { status: 500 }
      );
    }

    if (!assignment) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This assignment does not belong to you.",
        },
        { status: 403 }
      );
    }

    // ==========================================================
    // VERIFY CORRECT STATUS ORDER
    // ==========================================================

    const expectedNextStatus =
      ALLOWED_STATUS_TRANSITIONS[
        assignment.status as keyof typeof ALLOWED_STATUS_TRANSITIONS
      ];

    if (
      expectedNextStatus !== status
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            `Invalid status transition. Current status is "${assignment.status}" and the next allowed status is "${expectedNextStatus}".`,
        },
        { status: 409 }
      );
    }

    const now =
      new Date().toISOString();

    // ==========================================================
    // BUILD ASSIGNMENT UPDATE
    // ==========================================================

    const assignmentUpdates: any = {
      status,
      updated_at: now,
    };

    if (
      status === "acknowledged"
    ) {
      assignmentUpdates.acknowledged_at =
        now;
    }

    if (
      status === "en_route"
    ) {
      assignmentUpdates.route_started_at =
        now;
    }

    if (
      status === "arrived"
    ) {
      assignmentUpdates.arrived_at =
        now;
    }

    if (
      status === "completed"
    ) {
      assignmentUpdates.completed_at =
        now;
    }

    // ==========================================================
    // UPDATE ASSIGNMENT
    // ==========================================================

    const {
      data: updatedAssignment,
      error: updateAssignmentError,
    } =
      await supabaseServer
        .from("request_assignments")
        .update(assignmentUpdates)
        .eq("id", assignment.id)
        .eq(
          "responder_user_id",
          authUser.userId
        )
        .select()
        .single();

    if (updateAssignmentError) {
      console.error(
        "Assignment status update failed:",
        updateAssignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to update assignment status.",
        },
        { status: 500 }
      );
    }

    // ==========================================================
    // DETERMINE EMERGENCY REQUEST STATUS
    // ==========================================================

    let requestStatus =
      "assigned";

    if (
      status === "acknowledged"
    ) {
      requestStatus =
        "assigned";
    }

    if (
      status === "en_route"
    ) {
      requestStatus =
        "en_route";
    }

    if (
      status === "arrived"
    ) {
      requestStatus =
        "arrived";
    }

    if (
      status === "completed"
    ) {
      requestStatus =
        "closed";
    }

    // ==========================================================
    // LOAD CURRENT REQUEST
    // ==========================================================

    const {
      data: emergencyRequest,
      error: requestLookupError,
    } =
      await supabaseServer
        .from("emergency_requests")
        .select(
          "id, current_status"
        )
        .eq(
          "id",
          assignment.request_id
        )
        .maybeSingle();

    if (requestLookupError) {
      console.error(
        "Emergency request lookup failed:",
        requestLookupError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment updated, but the emergency request could not be loaded.",
        },
        { status: 500 }
      );
    }

    if (!emergencyRequest) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Emergency request not found.",
        },
        { status: 404 }
      );
    }

    // ==========================================================
    // UPDATE EMERGENCY REQUEST
    // ==========================================================

    const {
      error: requestUpdateError,
    } =
      await supabaseServer
        .from("emergency_requests")
        .update({
          current_status:
            requestStatus,
          updated_at: now,
        })
        .eq(
          "id",
          assignment.request_id
        );

    if (requestUpdateError) {
      console.error(
        "Emergency request update failed:",
        requestUpdateError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment status changed, but emergency request status could not be updated.",
        },
        { status: 500 }
      );
    }

    // ==========================================================
    // UPDATE RESPONDER AVAILABILITY
    // ==========================================================

    if (
      status === "completed"
    ) {
      const {
        error: responderUpdateError,
      } =
        await supabaseServer
          .from("responder_profiles")
          .update({
            availability:
              "available",
            updated_at: now,
          })
          .eq(
            "user_id",
            authUser.userId
          );

      if (responderUpdateError) {
        console.error(
          "Responder availability update failed:",
          responderUpdateError
        );

        return NextResponse.json(
          {
            ok: false,
            message:
              "Mission completed, but responder availability could not be reset.",
          },
          { status: 500 }
        );
      }
    }

    // ==========================================================
    // STATUS HISTORY
    // ==========================================================

    const {
      error: historyError,
    } =
      await supabaseServer
        .from("request_status_history")
        .insert({
          request_id:
            assignment.request_id,

          previous_status:
            emergencyRequest.current_status,

          new_status:
            requestStatus,

          changed_by_user_id:
            authUser.userId,

          actor_role:
            authUser.role,

          changed_by_system:
            false,

          reason:
            `Responder updated assignment to ${status}.`,

          note: null,
        });

    if (historyError) {
      console.error(
        "Status history insert failed:",
        historyError
      );
    }

    // ==========================================================
    // AUDIT LOG
    // ==========================================================

    const {
      error: auditError,
    } =
      await supabaseServer
        .from("audit_logs")
        .insert({
          actor_user_id:
            authUser.userId,

          actor_role:
            authUser.role,

          organisation_id:
            assignment.organisation_id,

          action:
            "emergency_request.responder_status_updated",

          target_type:
            "request_assignment",

          target_id:
            assignment.id,

          request_id:
            assignment.request_id,

          result:
            "success",

          safe_metadata: {
            previous_assignment_status:
              assignment.status,

            new_assignment_status:
              status,

            previous_request_status:
              emergencyRequest.current_status,

            new_request_status:
              requestStatus,
          },
        });

    if (auditError) {
      console.error(
        "Audit log insert failed:",
        auditError
      );
    }

    // ==========================================================
    // SUCCESS
    // ==========================================================

    return NextResponse.json(
      {
        ok: true,

        message:
          "Responder mission updated successfully.",

        assignment:
          updatedAssignment,

        request_status:
          requestStatus,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Responder mission PATCH error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to update responder mission.",
      },
      { status: 500 }
    );
  }
}
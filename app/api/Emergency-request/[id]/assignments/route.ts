import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase-server";
import { verifyAccessToken } from "@/lib/auth/jwt";

type AssignmentBody = {
  organisation_id?: string;
  team_id?: string | null;
  responder_user_id?: string | null;
  vehicle_id?: string | null;
  eta_minutes?: number | null;
  assignment_note?: string | null;
};

const ASSIGNABLE_REQUEST_STATUSES = [
  "submitted",
  "received",
] as const;

const ALLOWED_ASSIGNER_ROLES = [
  "dispatcher",
  "admin",
] as const;

/**
 * Read and verify the application's custom JWT.
 *
 * The JWT is stored in the HTTP-only "access_token" cookie
 * by /api/auth/login.
 */
async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return null;
  }

  const payload = await verifyAccessToken(token);

  if (!payload) {
    return null;
  }

  return payload;
}

/**
 * POST
 *
 * Creates an assignment for an emergency request.
 *
 * Flow:
 *
 * Dispatcher
 *   ↓
 * JWT verification
 *   ↓
 * Role check
 *   ↓
 * Organisation membership check
 *   ↓
 * Emergency request check
 *   ↓
 * Resource availability checks
 *   ↓
 * Create assignment
 *   ↓
 * Update responder/team/vehicle
 *   ↓
 * Update emergency request to "assigned"
 *   ↓
 * Create status history
 *   ↓
 * Create audit log
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ============================================================
    // 1. AUTHENTICATION
    // ============================================================

    const authUser = await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // ============================================================
    // 2. AUTHORISATION
    // ============================================================

    if (
      !ALLOWED_ASSIGNER_ROLES.includes(
        authUser.role as (typeof ALLOWED_ASSIGNER_ROLES)[number]
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You do not have permission to assign emergency requests.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // 3. REQUEST ID
    // ============================================================

    const { id: requestId } = await params;

    if (!requestId) {
      return NextResponse.json(
        {
          ok: false,
          message: "Emergency request ID is required.",
        },
        { status: 400 }
      );
    }

    // ============================================================
    // 4. REQUEST BODY
    // ============================================================

    let body: AssignmentBody;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid JSON request body.",
        },
        { status: 400 }
      );
    }

    const {
      organisation_id,
      team_id,
      responder_user_id,
      vehicle_id,
      eta_minutes,
      assignment_note,
    } = body;

    // ============================================================
    // 5. BASIC VALIDATION
    // ============================================================

    if (!organisation_id) {
      return NextResponse.json(
        {
          ok: false,
          message: "organisation_id is required.",
        },
        { status: 400 }
      );
    }

    if (!team_id && !responder_user_id && !vehicle_id) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "At least one resource must be assigned: responder, team, or vehicle.",
        },
        { status: 400 }
      );
    }

    if (
      eta_minutes !== undefined &&
      eta_minutes !== null &&
      (!Number.isInteger(eta_minutes) || eta_minutes < 0)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "eta_minutes must be a non-negative integer.",
        },
        { status: 400 }
      );
    }

    if (
      assignment_note !== undefined &&
      assignment_note !== null &&
      typeof assignment_note !== "string"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "assignment_note must be text.",
        },
        { status: 400 }
      );
    }

    // ============================================================
    // 6. VERIFY DISPATCHER'S ORGANISATION MEMBERSHIP
    // ============================================================

    const { data: membership, error: membershipError } =
      await supabaseServer
        .from("organisation_members")
        .select(
          "id, organisation_id, user_id, operational_role, permissions, status"
        )
        .eq("organisation_id", organisation_id)
        .eq("user_id", authUser.userId)
        .eq("status", "active")
        .maybeSingle();

    if (membershipError) {
      console.error(
        "Organisation membership lookup error:",
        membershipError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to verify dispatcher organisation membership.",
        },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You are not an active member of the selected organisation.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // 7. CHECK EMERGENCY REQUEST
    //
    // IMPORTANT:
    // The URL ID is the database UUID.
    // The reference_code is a separate human-readable value.
    // ============================================================

    const {
      data: emergencyRequest,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .select(
        `
        id,
        reference_code,
        requester_id,
        routed_organisation_id,
        current_status,
        is_active,
        is_cancelled,
        eta_minutes
        `
      )
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      console.error(
        "Emergency request lookup error:",
        requestError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to check emergency request.",
        },
        { status: 500 }
      );
    }

    if (!emergencyRequest) {
      return NextResponse.json(
        {
          ok: false,
          message: "Emergency request not found.",
        },
        { status: 404 }
      );
    }

    if (!emergencyRequest.is_active) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This emergency request is no longer active.",
        },
        { status: 409 }
      );
    }

    if (emergencyRequest.is_cancelled) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This emergency request has already been cancelled.",
        },
        { status: 409 }
      );
    }

    // ============================================================
    // 8. CHECK REQUEST STATUS
    //
    // Assignment is only allowed from submitted/received.
    // A request that is already assigned must not receive
    // another active assignment accidentally.
    // ============================================================

    if (
      !ASSIGNABLE_REQUEST_STATUSES.includes(
        emergencyRequest.current_status as
          (typeof ASSIGNABLE_REQUEST_STATUSES)[number]
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            `This request cannot be assigned while its current status is "${emergencyRequest.current_status}".`,
        },
        { status: 409 }
      );
    }

    // ============================================================
    // 9. CHECK REQUEST ORGANISATION
    //
    // If the request has already been routed to an organisation,
    // it must match the organisation doing the assignment.
    // ============================================================

    if (
      emergencyRequest.routed_organisation_id &&
      emergencyRequest.routed_organisation_id !== organisation_id
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This emergency request is routed to a different organisation.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // 10. CHECK ORGANISATION
    // ============================================================

    const {
      data: organisation,
      error: organisationError,
    } = await supabaseServer
      .from("organisations")
      .select("id, name, status")
      .eq("id", organisation_id)
      .maybeSingle();

    if (organisationError) {
      console.error(
        "Organisation lookup error:",
        organisationError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to check organisation.",
        },
        { status: 500 }
      );
    }

    if (!organisation) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organisation not found.",
        },
        { status: 404 }
      );
    }

    if (organisation.status !== "active") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "The selected organisation is not active.",
        },
        { status: 409 }
      );
    }

    // ============================================================
    // 11. CHECK RESPONDER
    // ============================================================

    let responder: {
      user_id: string;
      organisation_id: string;
      availability: string;
    } | null = null;

    if (responder_user_id) {
      const {
        data: responderData,
        error: responderError,
      } = await supabaseServer
        .from("responder_profiles")
        .select(
          "user_id, organisation_id, availability"
        )
        .eq("user_id", responder_user_id)
        .maybeSingle();

      if (responderError) {
        console.error(
          "Responder lookup error:",
          responderError
        );

        return NextResponse.json(
          {
            ok: false,
            message: "Unable to check responder.",
          },
          { status: 500 }
        );
      }

      if (!responderData) {
        return NextResponse.json(
          {
            ok: false,
            message: "Responder not found.",
          },
          { status: 404 }
        );
      }

      responder = responderData;

      if (
        responder.organisation_id !==
        organisation_id
      ) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Responder does not belong to the selected organisation.",
          },
          { status: 403 }
        );
      }

      if (responder.availability !== "available") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Responder is not currently available.",
          },
          { status: 409 }
        );
      }

      // Verify responder's user account is active
      const {
        data: responderUser,
        error: responderUserError,
      } = await supabaseServer
        .from("users")
        .select("id, role, status")
        .eq("id", responder_user_id)
        .maybeSingle();

      if (responderUserError) {
        console.error(
          "Responder user lookup error:",
          responderUserError
        );

        return NextResponse.json(
          {
            ok: false,
            message:
              "Unable to verify responder account.",
          },
          { status: 500 }
        );
      }

      if (!responderUser) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Responder user account not found.",
          },
          { status: 404 }
        );
      }

      if (responderUser.role !== "responder") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Selected user is not a responder.",
          },
          { status: 400 }
        );
      }

      if (responderUser.status !== "active") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Selected responder account is not active.",
          },
          { status: 409 }
        );
      }
    }

    // ============================================================
    // 12. CHECK TEAM
    // ============================================================

    if (team_id) {
      const {
        data: team,
        error: teamError,
      } = await supabaseServer
        .from("responder_teams")
        .select(
          "id, organisation_id, status"
        )
        .eq("id", team_id)
        .maybeSingle();

      if (teamError) {
        console.error(
          "Team lookup error:",
          teamError
        );

        return NextResponse.json(
          {
            ok: false,
            message: "Unable to check team.",
          },
          { status: 500 }
        );
      }

      if (!team) {
        return NextResponse.json(
          {
            ok: false,
            message: "Team not found.",
          },
          { status: 404 }
        );
      }

      if (
        team.organisation_id !==
        organisation_id
      ) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Team does not belong to the selected organisation.",
          },
          { status: 403 }
        );
      }

      if (team.status !== "available") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Team is not currently available.",
          },
          { status: 409 }
        );
      }
    }

    // ============================================================
    // 13. CHECK VEHICLE
    // ============================================================

    if (vehicle_id) {
      const {
        data: vehicle,
        error: vehicleError,
      } = await supabaseServer
        .from("vehicles")
        .select(
          "id, organisation_id, status"
        )
        .eq("id", vehicle_id)
        .maybeSingle();

      if (vehicleError) {
        console.error(
          "Vehicle lookup error:",
          vehicleError
        );

        return NextResponse.json(
          {
            ok: false,
            message: "Unable to check vehicle.",
          },
          { status: 500 }
        );
      }

      if (!vehicle) {
        return NextResponse.json(
          {
            ok: false,
            message: "Vehicle not found.",
          },
          { status: 404 }
        );
      }

      if (
        vehicle.organisation_id !==
        organisation_id
      ) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Vehicle does not belong to the selected organisation.",
          },
          { status: 403 }
        );
      }

      if (vehicle.status !== "available") {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Vehicle is not currently available.",
          },
          { status: 409 }
        );
      }
    }

    // ============================================================
    // 14. CHECK FOR EXISTING ACTIVE ASSIGNMENT
    // ============================================================

    const {
      data: existingAssignment,
      error: existingAssignmentError,
    } = await supabaseServer
      .from("request_assignments")
      .select(
        "id, status, responder_user_id, team_id, vehicle_id"
      )
      .eq("request_id", emergencyRequest.id)
      .in("status", [
        "assigned",
        "acknowledged",
        "en_route",
        "arrived",
      ])
      .limit(1)
      .maybeSingle();

    if (existingAssignmentError) {
      console.error(
        "Existing assignment lookup error:",
        existingAssignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to check existing assignment.",
        },
        { status: 500 }
      );
    }

    if (existingAssignment) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This emergency request already has an active assignment.",
        },
        { status: 409 }
      );
    }

    // ============================================================
    // 15. CREATE ASSIGNMENT
    // ============================================================

    const now = new Date().toISOString();

    const {
      data: assignment,
      error: assignmentError,
    } = await supabaseServer
      .from("request_assignments")
      .insert({
        request_id: emergencyRequest.id,
        organisation_id,
        team_id: team_id || null,
        responder_user_id:
          responder_user_id || null,
        vehicle_id: vehicle_id || null,

        /*
         * IMPORTANT:
         * Never trust assigned_by_user_id from the browser.
         * The dispatcher identity comes from the verified JWT.
         */
        assigned_by_user_id: authUser.userId,

        status: "assigned",

        eta_minutes:
          eta_minutes !== undefined &&
          eta_minutes !== null
            ? eta_minutes
            : null,

        assignment_note:
          assignment_note?.trim() || null,

        assigned_at: now,
      })
      .select()
      .single();

    if (assignmentError) {
      console.error(
        "Assignment creation error:",
        assignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Failed to create responder assignment.",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 16. UPDATE RESPONDER AVAILABILITY
    // ============================================================

    if (responder_user_id) {
      const {
        error: responderUpdateError,
      } = await supabaseServer
        .from("responder_profiles")
        .update({
          availability: "assigned",
          updated_at: now,
        })
        .eq("user_id", responder_user_id);

      if (responderUpdateError) {
        console.error(
          "Responder availability update failed:",
          responderUpdateError
        );

        // Roll back the assignment we just created.
        await supabaseServer
          .from("request_assignments")
          .delete()
          .eq("id", assignment.id);

        return NextResponse.json(
          {
            ok: false,
            message:
              "Assignment could not be completed because responder availability could not be updated.",
          },
          { status: 500 }
        );
      }
    }

    // ============================================================
    // 17. UPDATE TEAM
    // ============================================================

    if (team_id) {
      const {
        error: teamUpdateError,
      } = await supabaseServer
        .from("responder_teams")
        .update({
          status: "assigned",
          updated_at: now,
        })
        .eq("id", team_id);

      if (teamUpdateError) {
        console.error(
          "Team status update failed:",
          teamUpdateError
        );

        await supabaseServer
          .from("request_assignments")
          .delete()
          .eq("id", assignment.id);

        if (responder_user_id) {
          await supabaseServer
            .from("responder_profiles")
            .update({
              availability: "available",
              updated_at: now,
            })
            .eq("user_id", responder_user_id);
        }

        return NextResponse.json(
          {
            ok: false,
            message:
              "Assignment could not be completed because team availability could not be updated.",
          },
          { status: 500 }
        );
      }
    }

    // ============================================================
    // 18. UPDATE VEHICLE
    // ============================================================

    if (vehicle_id) {
      const {
        error: vehicleUpdateError,
      } = await supabaseServer
        .from("vehicles")
        .update({
          status: "assigned",
          updated_at: now,
        })
        .eq("id", vehicle_id);

      if (vehicleUpdateError) {
        console.error(
          "Vehicle status update failed:",
          vehicleUpdateError
        );

        await supabaseServer
          .from("request_assignments")
          .delete()
          .eq("id", assignment.id);

        if (responder_user_id) {
          await supabaseServer
            .from("responder_profiles")
            .update({
              availability: "available",
              updated_at: now,
            })
            .eq("user_id", responder_user_id);
        }

        if (team_id) {
          await supabaseServer
            .from("responder_teams")
            .update({
              status: "available",
              updated_at: now,
            })
            .eq("id", team_id);
        }

        return NextResponse.json(
          {
            ok: false,
            message:
              "Assignment could not be completed because vehicle availability could not be updated.",
          },
          { status: 500 }
        );
      }
    }

    // ============================================================
    // 19. UPDATE EMERGENCY REQUEST
    // ============================================================

    const {
      error: requestUpdateError,
    } = await supabaseServer
      .from("emergency_requests")
      .update({
        current_status: "assigned",
        assigned_at: now,
        eta_minutes:
          eta_minutes !== undefined &&
          eta_minutes !== null
            ? eta_minutes
            : emergencyRequest.eta_minutes,
        updated_at: now,
      })
      .eq("id", emergencyRequest.id)
      .in("current_status", [
        "submitted",
        "received",
      ]);

    if (requestUpdateError) {
      console.error(
        "Emergency request update failed:",
        requestUpdateError
      );

      // Best-effort rollback.
      await supabaseServer
        .from("request_assignments")
        .delete()
        .eq("id", assignment.id);

      if (responder_user_id) {
        await supabaseServer
          .from("responder_profiles")
          .update({
            availability: "available",
            updated_at: now,
          })
          .eq("user_id", responder_user_id);
      }

      if (team_id) {
        await supabaseServer
          .from("responder_teams")
          .update({
            status: "available",
            updated_at: now,
          })
          .eq("id", team_id);
      }

      if (vehicle_id) {
        await supabaseServer
          .from("vehicles")
          .update({
            status: "available",
            updated_at: now,
          })
          .eq("id", vehicle_id);
      }

      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment could not be completed because the emergency request status could not be updated.",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 20. STATUS HISTORY
    // ============================================================

    const {
      error: historyError,
    } = await supabaseServer
      .from("request_status_history")
      .insert({
        request_id: emergencyRequest.id,
        previous_status:
          emergencyRequest.current_status,
        new_status: "assigned",
        changed_by_user_id: authUser.userId,
        actor_role: authUser.role,
        changed_by_system: false,
        reason: "Responder assigned",
        note:
          assignment_note?.trim() || null,
      });

    if (historyError) {
      console.error(
        "Status history creation failed:",
        historyError
      );

      /*
       * Do not tell the user the assignment fully succeeded
       * when the required audit trail could not be written.
       *
       * The request and assignment are already changed here.
       * We return an error so this can be investigated.
       */
      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment was created, but the request status history could not be recorded.",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 21. AUDIT LOG
    // ============================================================

    const {
      error: auditError,
    } = await supabaseServer
      .from("audit_logs")
      .insert({
        actor_user_id: authUser.userId,
        actor_role: authUser.role,
        organisation_id,
        action: "emergency_request.assignment_created",
        target_type: "request_assignment",
        target_id: assignment.id,
        request_id: emergencyRequest.id,
        result: "success",
        safe_metadata: {
          reference_code:
            emergencyRequest.reference_code,
          responder_user_id:
            responder_user_id || null,
          team_id: team_id || null,
          vehicle_id: vehicle_id || null,
          eta_minutes:
            eta_minutes ?? null,
        },
      });

    if (auditError) {
      console.error(
        "Audit log creation failed:",
        auditError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment was created, but the audit record could not be written.",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 22. SUCCESS
    // ============================================================

    return NextResponse.json(
      {
        ok: true,
        message:
          "Responder assignment created successfully.",
        assignment,
        emergency_request: {
          id: emergencyRequest.id,
          reference_code:
            emergencyRequest.reference_code,
          current_status: "assigned",
          assigned_at: now,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Assignment API unexpected error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to create the responder assignment.",
      },
      { status: 500 }
    );
  }
}

/**
 * GET
 *
 * Returns one emergency request.
 *
 * The request ID is the database UUID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ============================================================
    // AUTHENTICATION
    // ============================================================

    const authUser = await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // ============================================================
    // AUTHORISATION
    // ============================================================

    const allowedRoles = [
      "requester",
      "dispatcher",
      "responder",
      "admin",
      "auditor",
    ];

    if (
      !allowedRoles.includes(authUser.role)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You do not have permission to view this request.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // REQUEST ID
    // ============================================================

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Emergency request ID is required.",
        },
        { status: 400 }
      );
    }

    // ============================================================
    // LOAD REQUEST
    // ============================================================

    const {
      data: emergencyRequest,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .select(
        `
        *,
        request_locations(*),
        request_status_history(*)
        `
      )
      .eq("id", id)
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
            "Unable to retrieve emergency request.",
        },
        { status: 500 }
      );
    }

    if (!emergencyRequest) {
      return NextResponse.json(
        {
          ok: false,
          message: "Emergency request not found.",
        },
        { status: 404 }
      );
    }

    // ============================================================
    // REQUESTER OWNERSHIP
    // ============================================================

    if (
      authUser.role === "requester" &&
      emergencyRequest.requester_id !==
        authUser.userId
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You are not allowed to view this emergency request.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // RESPONDER OWNERSHIP
    // ============================================================

    if (authUser.role === "responder") {
      const {
        data: assignment,
        error: assignmentError,
      } = await supabaseServer
        .from("request_assignments")
        .select("id")
        .eq("request_id", emergencyRequest.id)
        .eq("responder_user_id", authUser.userId)
        .in("status", [
          "assigned",
          "acknowledged",
          "en_route",
          "arrived",
        ])
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
              "Unable to verify responder assignment.",
          },
          { status: 500 }
        );
      }

      if (!assignment) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "You are not assigned to this emergency request.",
          },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        emergencyRequest,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "GET emergency request error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to retrieve emergency request.",
      },
      { status: 500 }
    );
  }
}
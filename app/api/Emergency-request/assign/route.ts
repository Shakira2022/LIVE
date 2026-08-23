
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export async function POST(request: Request) {
  try {
    /*
     * ---------------------------------------------------------
     * 1. Authenticate the current user
     * ---------------------------------------------------------
     *
     * getCurrentUser() supports:
     * - Authorization: Bearer <JWT>
     * - HTTP-only access_token cookie
     */
    const currentUser = await getCurrentUser(request);

    if (!currentUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 2. Read the request body
     * ---------------------------------------------------------
     */
    const body = await request.json();

    const {
      request_id,
      responder_id,
      team_id,
      vehicle_id,
      eta_minutes,
    } = body;

    /*
     * ---------------------------------------------------------
     * 3. Validate emergency request ID
     * ---------------------------------------------------------
     */
    if (!request_id) {
      return NextResponse.json(
        {
          ok: false,
          message: "Emergency request ID is required.",
        },
        { status: 400 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 4. Get the logged-in user's database record
     * ---------------------------------------------------------
     *
     * The JWT gives us the user ID.
     * We then check the users table for the actual role.
     */
    const {
      data: userData,
      error: userError,
    } = await supabaseServer
      .from("users")
      .select("id, role")
      .eq("id", currentUser.userId)
      .single();

    if (userError || !userData) {
      console.error("Could not find logged-in user:", userError);

      return NextResponse.json(
        {
          ok: false,
          message: "Logged-in user could not be found.",
        },
        { status: 401 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 5. Check dispatcher/admin permission
     * ---------------------------------------------------------
     */
    if (!["dispatcher", "admin"].includes(userData.role)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Only dispatchers or administrators can assign requests.",
        },
        { status: 403 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 6. Find the emergency request
     * ---------------------------------------------------------
     */
    const {
      data: requestData,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .select(
        "id, current_status, routed_organisation_id, requester_id, reference_code"
      )
      .eq("id", request_id)
      .single();

    if (requestError || !requestData) {
      console.error("Emergency request not found:", requestError);

      return NextResponse.json(
        {
          ok: false,
          message: "Emergency request not found.",
        },
        { status: 404 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 7. Check request status
     * ---------------------------------------------------------
     *
     * A submitted request can be assigned.
     */
    if (requestData.current_status !== "submitted") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Request has already been assigned or is no longer available for assignment.",
        },
        { status: 400 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 8. Make sure there is something to assign
     * ---------------------------------------------------------
     */
    if (!responder_id && !team_id) {
      return NextResponse.json(
        {
          ok: false,
          message: "A responder or team must be selected.",
        },
        { status: 400 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 9. Create the assignment
     * ---------------------------------------------------------
     */
    const {
      data: assignment,
      error: assignmentError,
    } = await supabaseServer
      .from("request_assignments")
      .insert({
        request_id: request_id,
        organisation_id:
          requestData.routed_organisation_id ?? null,
        responder_user_id: responder_id ?? null,
        team_id: team_id ?? null,
        vehicle_id: vehicle_id ?? null,
        assigned_by_user_id: currentUser.userId,
        status: "assigned",
        eta_minutes: eta_minutes ?? null,
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (assignmentError || !assignment) {
      console.error(
        "Assignment creation error:",
        assignmentError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Failed to assign responder.",
        },
        { status: 500 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 10. Update emergency request status
     * ---------------------------------------------------------
     */
    const {
      error: updateError,
    } = await supabaseServer
      .from("emergency_requests")
      .update({
        current_status: "assigned",
        assigned_at: new Date().toISOString(),
      })
      .eq("id", request_id);

    if (updateError) {
      console.error(
        "Emergency request status update error:",
        updateError
      );

      /*
       * We don't delete the assignment here because the
       * assignment was successfully created. The error is
       * returned so it can be investigated.
       */
      return NextResponse.json(
        {
          ok: false,
          message:
            "Assignment was created, but the emergency request status could not be updated.",
        },
        { status: 500 }
      );
    }

    /*
     * ---------------------------------------------------------
     * 11. Add status history
     * ---------------------------------------------------------
     */
    const {
      error: historyError,
    } = await supabaseServer
      .from("request_status_history")
      .insert({
        request_id: request_id,
        previous_status: "submitted",
        new_status: "assigned",
        changed_by_user_id: currentUser.userId,
        actor_role: userData.role,
        changed_by_system: false,
        note: responder_id
          ? "Emergency request assigned to responder."
          : "Emergency request assigned to responder team.",
      });

    if (historyError) {
      console.error(
        "Status history error:",
        historyError
      );

      /*
       * Assignment and request update already succeeded.
       * We don't fail the whole operation because of history.
       */
    }

    /*
     * ---------------------------------------------------------
     * 12. Create audit log
     * ---------------------------------------------------------
     */
    const {
      error: auditError,
    } = await supabaseServer
      .from("audit_logs")
      .insert({
        actor_user_id: currentUser.userId,
        actor_role: userData.role,
        action: "ASSIGN_REQUEST",
        target_type: "request_assignment",
        target_id: assignment.id,
        request_id: request_id,
        result: "success",
        safe_metadata: {
          assignment_id: assignment.id,
          responder_id: responder_id ?? null,
          team_id: team_id ?? null,
          vehicle_id: vehicle_id ?? null,
          eta_minutes: eta_minutes ?? null,
        },
      });

    if (auditError) {
      console.error(
        "Audit log error:",
        auditError
      );

      /*
       * Audit logging failure should not undo a successful
       * assignment.
       */
    }

    /*
     * ---------------------------------------------------------
     * 13. Create notification for responder
     * ---------------------------------------------------------
     *
     * We use the notification service already in your project.
     */
    if (responder_id) {
      try {
        const { createNotification } = await import(
          "@/lib/notifications/service"
        );

        await createNotification({
          recipientUserId: responder_id,
          requestId: request_id,
          notificationType: "assignment",
          title: "New Mission Assignment",
          message:
            "You have been assigned to an emergency request.",
          sensitivity: "normal",
        });

        console.log(
          "Responder notification created for:",
          responder_id
        );
      } catch (notificationError) {
        /*
         * The assignment itself has already succeeded.
         * Therefore, notification failure should not make
         * the assignment fail.
         */
        console.error(
          "Failed to create responder notification:",
          notificationError
        );
      }
    }

    /*
     * ---------------------------------------------------------
     * 14. Return success
     * ---------------------------------------------------------
     */
    return NextResponse.json(
      {
        ok: true,
        message: "Responder assigned successfully.",
        assignment,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Emergency request assignment error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}


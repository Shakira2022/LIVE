import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

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

const updateMissionSchema = z.object({
  assignment_id: z.string().min(1, "assignment_id is required."),
  status: z.enum([
    "acknowledged",
    "en_route",
    "arrived",
    "completed",
  ]),
});

/* -------------------------------------------------------------------------- */
/* GET /api/responder/mission                                                 */
/* -------------------------------------------------------------------------- */

export const GET = createHandler(
  {
    name: "responder.mission",
    auth: "required",
    roles: ["responder"],
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Authentication is provided by createHandler().
     *
     * IMPORTANT:
     * Do not manually read an "access_token" cookie here. The middleware
     * auth layer reads the actual configured COOKIE_ACCESS name and verifies
     * the same JWT issued by /api/auth/login.
     */
    const responderUserId = ctx.user.userId;

    const {
      data: assignment,
      error: assignmentError,
    } = await db()
      .from("request_assignments")
      .select("*")
      .eq(
        "responder_user_id",
        responderUserId,
      )
      .in(
        "status",
        ACTIVE_ASSIGNMENT_STATUSES,
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (assignmentError) {
      throw ApiError.internal(
        "Unable to load responder assignment.",
        assignmentError.message,
      );
    }

    if (!assignment) {
      return {
        mission: null,
      };
    }

    const {
      data: emergencyRequest,
      error: requestError,
    } = await db()
      .from("emergency_requests")
      .select("*")
      .eq(
        "id",
        assignment.request_id,
      )
      .maybeSingle();

    if (requestError) {
      throw ApiError.internal(
        "Unable to load emergency request.",
        requestError.message,
      );
    }

    if (!emergencyRequest) {
      throw new ApiError(
        "NOT_FOUND",
        "The assigned emergency request could not be found.",
      );
    }

    const [
      locationResult,
      historyResult,
      responderResult,
    ] = await Promise.all([
      db()
        .from("request_locations")
        .select("*")
        .eq(
          "request_id",
          emergencyRequest.id,
        )
        .maybeSingle(),

      db()
        .from("request_status_history")
        .select("*")
        .eq(
          "request_id",
          emergencyRequest.id,
        )
        .order("created_at", {
          ascending: true,
        }),

      db()
        .from("responder_profiles")
        .select(
          "user_id, availability",
        )
        .eq(
          "user_id",
          responderUserId,
        )
        .maybeSingle(),
    ]);

    if (locationResult.error) {
      ctx.log.warn(
        "responder_mission_location_lookup_failed",
        {
          dbError:
            locationResult.error.message,
        },
      );
    }

    if (historyResult.error) {
      ctx.log.warn(
        "responder_mission_history_lookup_failed",
        {
          dbError:
            historyResult.error.message,
        },
      );
    }

    if (responderResult.error) {
      ctx.log.warn(
        "responder_profile_lookup_failed",
        {
          dbError:
            responderResult.error.message,
        },
      );
    }

    return {
      mission: {
        assignment,
        request:
          emergencyRequest,
        location:
          locationResult.data ??
          null,
        statusHistory:
          historyResult.data ??
          [],
        responder:
          responderResult.data ??
          null,
      },
    };
  },
);

/* -------------------------------------------------------------------------- */
/* PATCH /api/responder/mission                                               */
/* -------------------------------------------------------------------------- */

export const PATCH = createHandler(
  {
    name: "responder.mission.update",
    auth: "required",
    roles: ["responder"],
    body: updateMissionSchema,
    rateLimit: {
      limit: 60,
      windowMs: 60_000,
      by: "user",
    },
    audit: {
      action:
        "emergency_request.responder_status_updated",
      targetType:
        "request_assignment",
    },
  },
  async (ctx) => {
    const responderUserId =
      ctx.user.userId;

    const {
      assignment_id,
      status,
    } = ctx.body;

    const {
      data: assignment,
      error: assignmentError,
    } = await db()
      .from("request_assignments")
      .select("*")
      .eq(
        "id",
        assignment_id,
      )
      .eq(
        "responder_user_id",
        responderUserId,
      )
      .maybeSingle();

    if (assignmentError) {
      throw ApiError.internal(
        "Unable to verify assignment.",
        assignmentError.message,
      );
    }

    if (!assignment) {
      throw new ApiError(
        "FORBIDDEN",
        "This assignment does not belong to you.",
      );
    }

    if (
      assignment.status ===
      "completed"
    ) {
      throw new ApiError(
        "CONFLICT",
        "This mission has already been completed.",
      );
    }

    const expectedNextStatus =
      ALLOWED_STATUS_TRANSITIONS[
        assignment.status as keyof typeof ALLOWED_STATUS_TRANSITIONS
      ];

    if (
      expectedNextStatus !==
      status
    ) {
      throw new ApiError(
        "CONFLICT",
        `Invalid status transition. Current status is "${assignment.status}" and the next allowed status is "${expectedNextStatus ?? "none"}".`,
      );
    }

    const now =
      new Date().toISOString();

    const assignmentUpdates:
      Record<string, unknown> = {
        status,
        updated_at: now,
      };

    if (
      status ===
      "acknowledged"
    ) {
      assignmentUpdates.acknowledged_at =
        now;
    }

    if (
      status ===
      "en_route"
    ) {
      assignmentUpdates.route_started_at =
        now;
    }

    if (
      status ===
      "arrived"
    ) {
      assignmentUpdates.arrived_at =
        now;
    }

    if (
      status ===
      "completed"
    ) {
      assignmentUpdates.completed_at =
        now;
    }

    const {
      data: updatedAssignment,
      error:
        updateAssignmentError,
    } = await db()
      .from("request_assignments")
      .update(
        assignmentUpdates,
      )
      .eq(
        "id",
        assignment.id,
      )
      .eq(
        "responder_user_id",
        responderUserId,
      )
      .select()
      .single();

    if (
      updateAssignmentError
    ) {
      throw ApiError.internal(
        "Unable to update assignment status.",
        updateAssignmentError.message,
      );
    }

    let requestStatus =
      "assigned";

    if (
      status ===
      "en_route"
    ) {
      requestStatus =
        "en_route";
    }

    if (
      status ===
      "arrived"
    ) {
      requestStatus =
        "arrived";
    }

    if (
      status ===
      "completed"
    ) {
      requestStatus =
        "closed";
    }

    const {
      data: emergencyRequest,
      error:
        requestLookupError,
    } = await db()
      .from("emergency_requests")
      .select(
        "id, current_status",
      )
      .eq(
        "id",
        assignment.request_id,
      )
      .maybeSingle();

    if (
      requestLookupError
    ) {
      throw ApiError.internal(
        "Assignment updated, but the emergency request could not be loaded.",
        requestLookupError.message,
      );
    }

    if (
      !emergencyRequest
    ) {
      throw new ApiError(
        "NOT_FOUND",
        "Emergency request not found.",
      );
    }

    const previousRequestStatus =
      emergencyRequest.current_status;

    const {
      error:
        requestUpdateError,
    } = await db()
      .from("emergency_requests")
      .update({
        current_status:
          requestStatus,
        updated_at:
          now,
      })
      .eq(
        "id",
        assignment.request_id,
      );

    if (
      requestUpdateError
    ) {
      throw ApiError.internal(
        "Assignment status changed, but emergency request status could not be updated.",
        requestUpdateError.message,
      );
    }

    if (
      status ===
      "completed"
    ) {
      const {
        error:
          responderUpdateError,
      } = await db()
        .from(
          "responder_profiles",
        )
        .update({
          availability:
            "available",
          updated_at:
            now,
        })
        .eq(
          "user_id",
          responderUserId,
        );

      if (
        responderUpdateError
      ) {
        ctx.log.warn(
          "responder_availability_update_failed",
          {
            dbError:
              responderUpdateError.message,
          },
        );
      }
    }

    const {
      error: historyError,
    } = await db()
      .from(
        "request_status_history",
      )
      .insert({
        request_id:
          assignment.request_id,
        previous_status:
          previousRequestStatus,
        new_status:
          requestStatus,
        changed_by_user_id:
          responderUserId,
        actor_role:
          ctx.user.role,
        changed_by_system:
          false,
        reason:
          `Responder updated assignment to ${status}.`,
        note:
          null,
      });

    if (historyError) {
      ctx.log.warn(
        "responder_status_history_insert_failed",
        {
          dbError:
            historyError.message,
        },
      );
    }

    ctx.audit({
      targetId:
        assignment.id,
      requestId:
        assignment.request_id,
      previousAssignmentStatus:
        assignment.status,
      newAssignmentStatus:
        status,
      previousRequestStatus,
      newRequestStatus:
        requestStatus,
    });

    return {
      message:
        status ===
        "completed"
          ? "Responder mission completed successfully."
          : "Responder mission updated successfully.",

      assignment:
        updatedAssignment,

      requestStatus,
    };
  },
);
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
      let queuedRequests: unknown[] = [];

      {
        const { data: queued, error: queuedError } = await db()
          .from("emergency_requests")
          .select("*")
          .in("current_status", ["submitted", "received"])
          .eq("is_active", true)
          .order("submitted_at", { ascending: true })
          .limit(20);

        if (queuedError) {
          throw ApiError.internal(
            "Unable to load queued responder requests.",
            queuedError.message,
          );
        }

        const requestIds = (queued ?? []).map((row) => row.id);
        const { data: locations, error: locationsError } = requestIds.length
          ? await db()
              .from("request_locations")
              .select("request_id, latitude, longitude, address_text, landmark, accuracy_meters, captured_at")
              .in("request_id", requestIds)
          : { data: [], error: null };

        if (locationsError) {
          throw ApiError.internal(
            "Unable to load queued request locations.",
            locationsError.message,
          );
        }

        const locationByRequest = new Map(
          (locations ?? []).map((location) => [location.request_id, location]),
        );

        queuedRequests = (queued ?? []).map((request) => {
          const location = locationByRequest.get(request.id);
          return {
            ...request,
            location: location
              ? {
                  address: location.address_text ?? location.landmark ?? "Request location",
                  lat: Number(location.latitude),
                  lng: Number(location.longitude),
                  accuracy: location.accuracy_meters,
                  capturedAt: location.captured_at,
                  method: "Map pin",
                }
              : null,
          };
        });
      }

      return {
        mission: null,
        queuedRequests,
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
      requesterResult,
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
        .from("users")
        .select("id, first_name, last_name, display_name, phone")
        .eq("id", emergencyRequest.requester_id)
        .maybeSingle(),

      db()
        .from("responder_profiles")
        .select(
          "user_id, availability, current_latitude, current_longitude",
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
          {
            ...emergencyRequest,
            requester_name:
              requesterResult.data?.display_name ||
              [requesterResult.data?.first_name, requesterResult.data?.last_name]
                .filter(Boolean)
                .join(" ") ||
              "Requester",
            requester_phone: requesterResult.data?.phone ?? null,
          },
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

    if (status === "arrived") {
      const [locationResult, responderResult] = await Promise.all([
        db()
          .from("request_locations")
          .select("latitude, longitude")
          .eq("request_id", assignment.request_id)
          .maybeSingle(),
        db()
          .from("responder_profiles")
          .select("current_latitude, current_longitude")
          .eq("user_id", responderUserId)
          .maybeSingle(),
      ]);

      if (locationResult.error || responderResult.error) {
        throw ApiError.internal(
          "Unable to verify responder proximity.",
          locationResult.error?.message || responderResult.error?.message,
        );
      }

      const requestLatitude = Number(locationResult.data?.latitude);
      const requestLongitude = Number(locationResult.data?.longitude);
      const responderLatitude = Number(responderResult.data?.current_latitude);
      const responderLongitude = Number(responderResult.data?.current_longitude);

      if (
        !Number.isFinite(requestLatitude) ||
        !Number.isFinite(requestLongitude) ||
        !Number.isFinite(responderLatitude) ||
        !Number.isFinite(responderLongitude)
      ) {
        throw new ApiError(
          "CONFLICT",
          "Update your current location before marking the mission arrived.",
        );
      }

      const distanceMetres = distanceMetresBetween(
        responderLatitude,
        responderLongitude,
        requestLatitude,
        requestLongitude,
      );

      if (distanceMetres > ARRIVAL_THRESHOLD_METRES) {
        throw new ApiError(
          "CONFLICT",
          `You are ${Math.round(distanceMetres)} m from the scene. Arrived becomes available within ${ARRIVAL_THRESHOLD_METRES} m.`,
        );
      }
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

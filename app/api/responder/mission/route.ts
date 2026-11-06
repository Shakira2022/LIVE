import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { getOrganisationMapCenter, type MapCenter } from "@/lib/middleware/server/organisation-map-center";
import { notifyOrganisationDispatchers } from "@/lib/notifications/service";
import {
  assignNextQueuedRequest,
  reconcileResponderTerminalAssignments,
} from "@/lib/middleware/server/requests-service";

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

    const { data: responderProfile, error: responderProfileError } = await db()
      .from("responder_profiles")
      .select("user_id, organisation_id, availability, go_offline_after_mission, current_latitude, current_longitude")
      .eq("user_id", responderUserId)
      .maybeSingle();

    if (responderProfileError) {
      throw ApiError.internal("Unable to load responder availability.", responderProfileError.message);
    }
    if (!responderProfile) {
      throw ApiError.notFound("A responder profile was not found for this account.");
    }
    let currentResponderProfile = responderProfile;
    let mapCenter: MapCenter | null = null;
    const loadOrganisationMapCenter = async () => {
      if (!currentResponderProfile.organisation_id) {
        throw ApiError.internal(
          "The responder account has no organisation location for its map fallback.",
        );
      }

      try {
        const organisationCenter = await getOrganisationMapCenter(currentResponderProfile.organisation_id);
        if (!organisationCenter) {
          throw ApiError.internal(
            "Set coordinates, city, or province for this organisation before using its map fallback.",
          );
        }
        return organisationCenter;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw ApiError.internal(
          "Unable to determine the responder organisation map area.",
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    await reconcileResponderTerminalAssignments(responderUserId);

    const { data: reconciledResponderProfile, error: reconciledResponderProfileError } = await db()
      .from("responder_profiles")
      .select("user_id, organisation_id, availability, go_offline_after_mission, current_latitude, current_longitude")
      .eq("user_id", responderUserId)
      .maybeSingle();

    if (reconciledResponderProfileError) {
      throw ApiError.internal("Unable to refresh responder availability after assignment cleanup.", reconciledResponderProfileError.message);
    }
    if (!reconciledResponderProfile) {
      throw ApiError.notFound("A responder profile was not found for this account.");
    }
    currentResponderProfile = reconciledResponderProfile;

    const readActiveAssignment = () => db()
      .from("request_assignments")
      .select("*")
      .eq("responder_user_id", responderUserId)
      .in("status", ACTIVE_ASSIGNMENT_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let { data: assignment, error: assignmentError } = await readActiveAssignment();

    if (assignmentError) {
      throw ApiError.internal(
        "Unable to load responder assignment.",
        assignmentError.message,
      );
    }

    // Direct SQL seeded requests do not run the normal request-submission
    // assignment hook. If this responder is already online, offer them the
    // oldest eligible queued request instead of leaving them available while
    // the page incorrectly tells them to go online.
    if (!assignment && currentResponderProfile.availability === "available" && currentResponderProfile.organisation_id) {
      const assignmentAttempt = await assignNextQueuedRequest(
        responderUserId,
        currentResponderProfile.organisation_id,
      );

      if (assignmentAttempt.assigned) {
        const refreshed = await readActiveAssignment();
        assignment = refreshed.data;
        assignmentError = refreshed.error;
        if (assignmentError) {
          throw ApiError.internal("Unable to load the newly assigned responder mission.", assignmentError.message);
        }
      }
    }

    const expectedAvailability = assignment
      ? assignment.status === "en_route"
        ? "en_route"
        : assignment.status === "arrived"
          ? "on_scene"
          : "assigned"
      : ["assigned", "en_route", "on_scene"].includes(currentResponderProfile.availability)
        ? "available"
        : currentResponderProfile.availability;
    const goOfflineAfterMission = Boolean(assignment && (
      currentResponderProfile.go_offline_after_mission || currentResponderProfile.availability === "offline"
    ));

    if (
      currentResponderProfile.availability !== expectedAvailability ||
      currentResponderProfile.go_offline_after_mission !== goOfflineAfterMission
    ) {
      const { data: repairedProfile, error: repairError } = await db()
        .from("responder_profiles")
        .update({
          availability: expectedAvailability,
          go_offline_after_mission: goOfflineAfterMission,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", responderUserId)
        .select("user_id, organisation_id, availability, go_offline_after_mission, current_latitude, current_longitude")
        .single();

      if (repairError) {
        throw ApiError.internal("Unable to reconcile responder availability.", repairError.message);
      }
      currentResponderProfile = repairedProfile;
    }

    if (!assignment) {
      let queuedRequests: unknown[] = [];

      {
        const { data: queued, error: queuedError } = await db()
          .from("emergency_requests")
          .select("*")
          .in("current_status", ["submitted", "received"])
          .is("cancellation_requested_at", null)
          .or(`routed_organisation_id.eq.${currentResponderProfile.organisation_id},routed_organisation_id.is.null`)
          .order("submitted_at", { ascending: true })
          .limit(20);

        if (queuedError) {
          throw ApiError.internal(
            "Unable to load queued responder requests.",
            queuedError.message,
          );
        }

        const queuedRequestIds = (queued ?? []).map((row) => row.id);
        const { data: activeQueueAssignments, error: activeQueueAssignmentsError } = queuedRequestIds.length
          ? await db()
              .from("request_assignments")
              .select("request_id")
              .in("request_id", queuedRequestIds)
              .in("status", ACTIVE_ASSIGNMENT_STATUSES)
          : { data: [], error: null };

        if (activeQueueAssignmentsError) {
          throw ApiError.internal("Unable to check queued request assignments.", activeQueueAssignmentsError.message);
        }

        const assignedRequestIds = new Set((activeQueueAssignments ?? []).map((item) => item.request_id));
        const unassignedQueue = (queued ?? []).filter((row) => !assignedRequestIds.has(row.id));
        const requestIds = unassignedQueue.map((row) => row.id);
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

        queuedRequests = unassignedQueue.map((request) => {
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

      const hasRequestLocation = queuedRequests.some((request: any) =>
        Number.isFinite(Number(request.location?.lat)) &&
        Number.isFinite(Number(request.location?.lng)) &&
        !(Number(request.location?.lat) === 0 && Number(request.location?.lng) === 0),
      );
      if (!hasRequestLocation) mapCenter = await loadOrganisationMapCenter();

      return {
        mission: null,
        queuedRequests,
        responder: currentResponderProfile,
        mapCenter,
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
          "user_id, availability, go_offline_after_mission, current_latitude, current_longitude",
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

    const hasRequestLocation = locationResult.data &&
      Number.isFinite(Number(locationResult.data.latitude)) &&
      Number.isFinite(Number(locationResult.data.longitude)) &&
      !(Number(locationResult.data.latitude) === 0 && Number(locationResult.data.longitude) === 0);
    if (!hasRequestLocation) mapCenter = await loadOrganisationMapCenter();

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
      mapCenter,
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

    let postMissionAvailability: string | null = null;
    let finalResponderAvailability: string | null = null;
    if (status === "completed") {
      const { data: responderProfile, error: responderProfileError } = await db()
        .from("responder_profiles")
        .select("availability, go_offline_after_mission")
        .eq("user_id", responderUserId)
        .maybeSingle();

      if (responderProfileError) {
        throw ApiError.internal(
          "Unable to load responder availability before completing the mission.",
          responderProfileError.message,
        );
      }
      if (!responderProfile) {
        throw ApiError.notFound("A responder profile was not found for this account.");
      }
      postMissionAvailability = responderProfile.go_offline_after_mission || responderProfile.availability === "offline"
        ? "offline"
        : "available";
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
        "id, current_status, reference_code, routed_organisation_id",
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
      let availabilityUpdate = db()
        .from(
          "responder_profiles",
        )
        .update({
          availability: postMissionAvailability ?? "available",
          go_offline_after_mission: false,
          updated_at:
            now,
        })
        .eq(
          "user_id",
          responderUserId,
        );

      if (postMissionAvailability !== "offline") {
        availabilityUpdate = availabilityUpdate.neq("availability", "offline");
      }

      const { error: responderUpdateError } = await availabilityUpdate;

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

      const { data: latestResponderProfile, error: latestResponderProfileError } = await db()
        .from("responder_profiles")
        .select("availability")
        .eq("user_id", responderUserId)
        .maybeSingle();

      if (latestResponderProfileError) {
        ctx.log.warn("responder_availability_confirmation_failed", {
          dbError: latestResponderProfileError.message,
        });
      } else {
        finalResponderAvailability = latestResponderProfile?.availability ?? postMissionAvailability;
      }

      try {
        await notifyOrganisationDispatchers({
          organisationId: assignment.organisation_id ?? emergencyRequest.routed_organisation_id,
          requestId: assignment.request_id,
          notificationType: "request_completed",
          title: "Request completed",
          message: `A responder completed request ${emergencyRequest.reference_code ?? assignment.request_id}.`,
          sensitivity: "normal",
        });
      } catch (notificationError) {
        ctx.log.warn("dispatcher_completion_notification_failed", {
          error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
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

      responderAvailability: finalResponderAvailability,

      requestStatus,
    };
  },
);

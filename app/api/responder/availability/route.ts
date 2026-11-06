import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import {
  assignNextQueuedRequest,
  reconcileResponderTerminalAssignments,
} from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

const availabilitySchema = z.object({
  availability: z.enum(["available", "offline"]).optional(),
  go_offline_after_mission: z.boolean().optional(),
}).refine((value) => value.availability !== undefined || value.go_offline_after_mission !== undefined, {
  message: "Choose an availability or offline-after-mission update.",
});

export const GET = createHandler(
  {
    name: "responder.availability.get",
    auth: "required",
    roles: ["responder"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const { data: profile, error } = await db()
      .from("responder_profiles")
      .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to load responder availability.", error.message);
    if (!profile) throw ApiError.notFound("A responder profile was not found for this account.");

    await reconcileResponderTerminalAssignments(ctx.user.userId);

    const { data: reconciledProfile, error: reconciledProfileError } = await db()
      .from("responder_profiles")
      .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();

    if (reconciledProfileError) throw ApiError.internal("Unable to refresh responder availability.", reconciledProfileError.message);
    if (!reconciledProfile) throw ApiError.notFound("A responder profile was not found for this account.");

    const { data: activeAssignment, error: assignmentError } = await db()
      .from("request_assignments")
      .select("id, status")
      .eq("responder_user_id", ctx.user.userId)
      .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
      .limit(1)
      .maybeSingle();

    if (assignmentError) throw ApiError.internal("Unable to verify responder mission status.", assignmentError.message);

    const activeAssignmentStatus = activeAssignment?.status ?? null;
    const expectedAvailability = activeAssignment
      ? activeAssignment.status === "en_route"
        ? "en_route"
        : activeAssignment.status === "arrived"
          ? "on_scene"
          : "assigned"
      : ["assigned", "en_route", "on_scene"].includes(reconciledProfile.availability)
        ? "available"
        : reconciledProfile.availability;
    const goOfflineAfterMission = Boolean(activeAssignment && (
      reconciledProfile.go_offline_after_mission || reconciledProfile.availability === "offline"
    ));

    let responder = reconciledProfile;
    if (
      reconciledProfile.availability !== expectedAvailability ||
      reconciledProfile.go_offline_after_mission !== goOfflineAfterMission
    ) {
      const { data: repaired, error: repairError } = await db()
        .from("responder_profiles")
        .update({
          availability: expectedAvailability,
          go_offline_after_mission: goOfflineAfterMission,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", ctx.user.userId)
        .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
        .single();

      if (repairError) throw ApiError.internal("Unable to repair stale responder availability.", repairError.message);
      responder = repaired;
    }

    return { responder, active_assignment_status: activeAssignmentStatus };
  },
);

export const PATCH = createHandler(
  {
    name: "responder.availability.update",
    auth: "required",
    roles: ["responder"],
    body: availabilitySchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
    audit: { action: "responder.availability_updated", targetType: "responder_profile" },
  },
  async (ctx) => {
    await reconcileResponderTerminalAssignments(ctx.user.userId);

    const { data: activeAssignment, error: assignmentError } = await db()
      .from("request_assignments")
      .select("id, status")
      .eq("responder_user_id", ctx.user.userId)
      .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
      .limit(1)
      .maybeSingle();

    if (assignmentError) throw ApiError.internal("Unable to check active assignment.", assignmentError.message);

    // The generated database type narrows this query's selected row to never
    // in this route; retain the two fields selected above explicitly.
    const currentAssignment = activeAssignment as unknown as { id: string; status: string } | null;

    if (currentAssignment && ctx.body.availability === "available") {
      throw new ApiError("CONFLICT", "Complete the on-scene mission before going online for another request.");
    }

    const now = new Date().toISOString();
    if (currentAssignment) {
      const goOfflineAfterMission = ctx.body.go_offline_after_mission ?? ctx.body.availability === "offline";
      const activeAvailability = currentAssignment.status === "en_route"
        ? "en_route"
        : currentAssignment.status === "arrived"
          ? "on_scene"
          : "assigned";
      const { data, error } = await db()
        .from("responder_profiles")
        .update({
          availability: activeAvailability,
          go_offline_after_mission: goOfflineAfterMission,
          updated_at: now,
        })
        .eq("user_id", ctx.user.userId)
        .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
        .maybeSingle();

      if (error) throw ApiError.internal("Unable to schedule responder availability after this mission.", error.message);
      if (!data) throw ApiError.notFound("A responder profile was not found for this account.");

      ctx.audit({
        targetId: ctx.user.userId,
        availability: data.availability,
        goOfflineAfterMission,
      });
      return {
        responder: data,
        active_assignment_status: currentAssignment.status,
        assignment: { assigned: false, reason: goOfflineAfterMission ? "offline_after_mission_scheduled" : "offline_after_mission_cleared" },
      };
    }

    if (ctx.body.go_offline_after_mission === true) {
      throw new ApiError("CONFLICT", "You can schedule going offline only while assigned to a mission.");
    }

    const update = ctx.body.availability === undefined
      ? { go_offline_after_mission: false, updated_at: now }
      : ctx.body.availability === "available"
        ? { availability: "available", go_offline_after_mission: false, shift_started_at: now, updated_at: now }
        : { availability: "offline", go_offline_after_mission: false, updated_at: now };

    const { data, error } = await db()
      .from("responder_profiles")
      .update(update)
      .eq("user_id", ctx.user.userId)
      .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to update responder availability.", error.message);
    if (!data) throw ApiError.notFound("A responder profile was not found for this account.");

    let assignmentResult: { assigned: boolean; reason?: string } = {
      assigned: false,
      reason: "not_requested",
    };

    if (ctx.body.availability === "available" && data.organisation_id) {
      try {
        assignmentResult = await assignNextQueuedRequest(ctx.user.userId, data.organisation_id);
      } catch (assignmentError) {
        assignmentResult = {
          assigned: false,
          reason: assignmentError instanceof Error ? assignmentError.message : "assignment_failed",
        };
      }
    }

    const { data: latestResponder, error: latestResponderError } = await db()
      .from("responder_profiles")
      .select("availability, go_offline_after_mission, organisation_id, shift_started_at, last_location_at")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();

    if (latestResponderError) {
      throw ApiError.internal("Unable to confirm responder availability.", latestResponderError.message);
    }

    ctx.audit({ targetId: ctx.user.userId, availability: latestResponder?.availability ?? data.availability });
    return {
      responder: latestResponder ?? data,
      active_assignment_status: activeAssignment?.status ?? null,
      assignment: assignmentResult,
    };
  },
);

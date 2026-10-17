import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { assignNextQueuedRequest } from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

const availabilitySchema = z.object({
  availability: z.enum(["available", "offline"]),
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
      .select("availability, organisation_id, shift_started_at, last_location_at")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to load responder availability.", error.message);
    if (!profile) throw ApiError.notFound("A responder profile was not found for this account.");

    let responder = profile;
    let activeAssignmentStatus: string | null = null;
    if (["assigned", "en_route", "on_scene"].includes(profile.availability)) {
      const { data: activeAssignment, error: assignmentError } = await db()
        .from("request_assignments")
        .select("id, status")
        .eq("responder_user_id", ctx.user.userId)
        .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
        .limit(1)
        .maybeSingle();

      if (assignmentError) throw ApiError.internal("Unable to verify responder mission status.", assignmentError.message);

      activeAssignmentStatus = activeAssignment?.status ?? null;

      if (!activeAssignment) {
        const { data: repaired, error: repairError } = await db()
          .from("responder_profiles")
          .update({ availability: "offline", updated_at: new Date().toISOString() })
          .eq("user_id", ctx.user.userId)
          .select("availability, organisation_id, shift_started_at, last_location_at")
          .single();

        if (repairError) throw ApiError.internal("Unable to repair stale responder availability.", repairError.message);
        responder = repaired;
      }
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
    const { data: activeAssignment, error: assignmentError } = await db()
      .from("request_assignments")
      .select("id, status")
      .eq("responder_user_id", ctx.user.userId)
      .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
      .limit(1)
      .maybeSingle();

    if (assignmentError) throw ApiError.internal("Unable to check active assignment.", assignmentError.message);

    if (activeAssignment && activeAssignment.status !== "arrived") {
      throw new ApiError("CONFLICT", "You can change availability after the mission reaches on scene.");
    }

    if (activeAssignment && ctx.body.availability === "available") {
      throw new ApiError("CONFLICT", "Complete the on-scene mission before going online for another request.");
    }

    const now = new Date().toISOString();
    const update = ctx.body.availability === "available"
      ? { availability: "available", shift_started_at: now, updated_at: now }
      : { availability: "offline", updated_at: now };

    const { data, error } = await db()
      .from("responder_profiles")
      .update(update)
      .eq("user_id", ctx.user.userId)
      .select("availability, organisation_id, shift_started_at, last_location_at")
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
      .select("availability, organisation_id, shift_started_at, last_location_at")
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

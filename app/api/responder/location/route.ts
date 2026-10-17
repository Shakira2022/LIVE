import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().optional(),
});

export const PATCH = createHandler(
  {
    name: "responder.location.update",
    auth: "required",
    roles: ["responder"],
    body: locationSchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from("responder_profiles")
      .update({
        current_latitude: ctx.body.latitude,
        current_longitude: ctx.body.longitude,
        location_accuracy_meters: ctx.body.accuracyMeters ?? null,
        last_location_at: now,
        updated_at: now,
      })
      .eq("user_id", ctx.user.userId)
      .select("user_id, current_latitude, current_longitude, location_accuracy_meters, last_location_at")
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to save responder location.", error.message);
    if (!data) throw ApiError.notFound("A responder profile was not found for this account.");
    return { location: data };
  },
);

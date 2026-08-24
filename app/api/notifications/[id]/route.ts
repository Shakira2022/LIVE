import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const updateSchema = z.object({
  read: z.boolean().optional().default(true),
});

/* -------------------------------------------------------------------------- */
/* PATCH /api/notifications/[id]                                              */
/* -------------------------------------------------------------------------- */

export const PATCH = createHandler(
  {
    name: "notifications.update",
    auth: "required",
    params: paramsSchema,
    body: updateSchema,
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Ownership is enforced in the database query itself.
     *
     * A user can only update a notification where:
     *   recipient_user_id === authenticated user id
     */
    const {
      data: existing,
      error: lookupError,
    } = await db()
      .from("notifications")
      .select(
        "id, recipient_user_id, read_at",
      )
      .eq(
        "id",
        ctx.params.id,
      )
      .eq(
        "recipient_user_id",
        ctx.user.userId,
      )
      .maybeSingle();

    if (lookupError) {
      throw ApiError.internal(
        "Unable to find notification.",
        lookupError.message,
      );
    }

    if (!existing) {
      throw new ApiError(
        "NOT_FOUND",
        "Notification not found.",
      );
    }

    const {
      data,
      error,
    } = await db()
      .from("notifications")
      .update({
        read_at:
          ctx.body.read
            ? new Date().toISOString()
            : null,
      })
      .eq(
        "id",
        ctx.params.id,
      )
      .eq(
        "recipient_user_id",
        ctx.user.userId,
      )
      .select(
        "id, recipient_user_id, request_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
      )
      .single();

    if (error) {
      throw ApiError.internal(
        "Unable to update notification.",
        error.message,
      );
    }

    return {
      notification: data,
    };
  },
);
import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { createNotification } from "@/lib/notifications/service";

export const runtime = "nodejs";

const createNotificationSchema = z.object({
  recipientUserId: z.string().uuid(),
  requestId: z.string().uuid().nullable().optional(),
  notificationType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  sensitivity: z.string().trim().max(50).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* GET /api/notifications                                                     */
/* -------------------------------------------------------------------------- */

export const GET = createHandler(
  {
    name: "notifications.list",
    auth: "required",
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Authentication comes from createHandler().
     *
     * Do NOT manually call getCurrentUser() here. The middleware pipeline
     * reads the configured access-token cookie and verifies the same JWT
     * issued by /api/auth/login.
     */
    const { data, error } = await db()
      .from("notifications")
      .select(
        "id, recipient_user_id, request_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
      )
      .eq(
        "recipient_user_id",
        ctx.user.userId,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw ApiError.internal(
        "Unable to retrieve notifications.",
        error.message,
      );
    }

    return {
      notifications: data ?? [],
    };
  },
);

/* -------------------------------------------------------------------------- */
/* POST /api/notifications                                                    */
/* -------------------------------------------------------------------------- */

export const POST = createHandler(
  {
    name: "notifications.create",
    auth: "required",
    body: createNotificationSchema,
    rateLimit: {
      limit: 60,
      windowMs: 60_000,
      by: "user",
    },
    successStatus: 201,
  },
  async (ctx) => {
    /*
     * Preserve the existing createNotification service.
     *
     * This route only changes authentication/validation so it uses the same
     * middleware session as the rest of the application.
     */
    const notification =
      await createNotification({
        recipientUserId:
          ctx.body.recipientUserId,

        requestId:
          ctx.body.requestId ??
          undefined,

        notificationType:
          ctx.body.notificationType,

        title:
          ctx.body.title,

        message:
          ctx.body.message,

        sensitivity:
          ctx.body.sensitivity,

        expiresAt:
          ctx.body.expiresAt ??
          undefined,
      });

    return {
      notification,
    };
  },
);
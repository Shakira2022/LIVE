import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

/* -------------------------------------------------------------------------- */
/* GET /api/notifications/unread-count                                        */
/* -------------------------------------------------------------------------- */

export const GET = createHandler(
  {
    name: "notifications.unread_count",
    auth: "required",
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    const {
      count,
      error,
    } = await db()
      .from("notifications")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "recipient_user_id",
        ctx.user.userId,
      )
      .is(
        "read_at",
        null,
      );

    if (error) {
      throw ApiError.internal(
        "Unable to retrieve unread notification count.",
        error.message,
      );
    }

    return {
      unreadCount:
        count ?? 0,
    };
  },
);
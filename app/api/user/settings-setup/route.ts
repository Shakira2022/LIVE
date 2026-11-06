import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { CURRENT_TERMS_VERSION } from "@/lib/legal-terms";

export const runtime = "nodejs";

export const POST = createHandler(
  {
    name: "user.settings_setup.complete",
    auth: "required",
    body: z.object({}),
    rateLimit: { limit: 5, windowMs: 60_000, by: "user" },
    audit: { action: "user_settings_setup_completed", targetType: "user" },
  },
  async (ctx) => {
    const completedAt = new Date().toISOString();
    const { data, error } = await db()
      .from("users")
      .update({ settings_setup_completed_at: completedAt })
      .eq("id", ctx.user.userId)
      .eq("terms_accepted_version", CURRENT_TERMS_VERSION)
      .not("terms_accepted_at", "is", null)
      .is("deleted_at", null)
      .select("settings_setup_completed_at")
      .single();

    if (error?.code === "42703") {
      throw ApiError.internal(
        "Settings setup storage is not ready. Apply migration 0014_user_settings_setup.sql.",
        error.message,
      );
    }
    if (error?.code === "PGRST116") throw ApiError.forbidden("Accept the current Terms and Conditions before finishing setup.");
    if (error || !data) throw ApiError.internal("Unable to save your settings setup.", error?.message);

    return { completedAt: data.settings_setup_completed_at as string };
  },
);

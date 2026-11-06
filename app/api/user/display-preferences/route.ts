import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  theme: z.enum(["light", "dark"]),
});

export const PATCH = createHandler(
  {
    name: "user.display_preferences.update",
    auth: "required",
    body: bodySchema,
    rateLimit: { limit: 20, windowMs: 60_000, by: "user" },
    audit: { action: "user_display_theme_updated", targetType: "user" },
  },
  async (ctx) => {
    const { data, error } = await db()
      .from("user_display_preferences")
      .upsert({
        user_id: ctx.user.userId,
        theme: ctx.body.theme,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("theme")
      .single();

    if (error?.code === "42P01") {
      throw ApiError.internal(
        "Display preferences are not set up. Apply migration 0012_user_display_preferences.sql.",
        error.message,
      );
    }
    if (error) throw ApiError.internal("Unable to save your display preference.", error.message);

    return { theme: data.theme as "light" | "dark" };
  },
);

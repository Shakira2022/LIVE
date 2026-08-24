import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const settingBodySchema = z.object({
  settingKey: z.string().trim().min(1),
  settingValue: z.unknown(),
  description: z.string().nullable().optional(),
  isPublic: z.boolean().optional().default(false),
});

export const GET = createHandler(
  {
    name: "admin.settings.read",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const { data, error } = await db()
      .from("system_settings")
      .select("setting_key,setting_value,description,is_public,updated_by_user_id,updated_at")
      .order("setting_key", { ascending: true });

    if (error) {
      throw ApiError.internal("Unable to retrieve system settings.", error.message);
    }

    return { settings: data ?? [] };
  },
);

export const PATCH = createHandler(
  {
    name: "admin.settings.update",
    auth: "required",
    roles: ["admin"],
    body: settingBodySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_system_setting_updated",
      targetType: "system_setting",
    },
  },
  async (ctx) => {
    const { data, error } = await db()
      .from("system_settings")
      .upsert(
        {
          setting_key: ctx.body.settingKey,
          setting_value: ctx.body.settingValue,
          description: ctx.body.description ?? null,
          is_public: ctx.body.isPublic,
          updated_by_user_id: ctx.user.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      )
      .select()
      .single();

    if (error) {
      throw ApiError.internal("Unable to update the system setting.", error.message);
    }

    ctx.audit({
      targetId: ctx.body.settingKey,
      settingKey: ctx.body.settingKey,
    });

    return { setting: data };
  },
)
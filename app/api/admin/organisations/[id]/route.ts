import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  status: z.enum(["active", "paused", "inactive"]),
});

export const PATCH = createHandler(
  {
    name: "admin.organisation.update",
    auth: "required",
    roles: ["admin"],
    params: paramsSchema,
    body: bodySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_organisation_status_updated",
      targetType: "organisation",
    },
  },
  async (ctx) => {
    const { data, error } = await db()
      .from("organisations")
      .update({
        status: ctx.body.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.params.id)
      .select("*")
      .single();

    if (error) {
      throw ApiError.internal("Unable to update the organisation.", error.message);
    }

    ctx.audit({
      targetId: ctx.params.id,
      newStatus: ctx.body.status,
    });

    return { organisation: data };
  },
);
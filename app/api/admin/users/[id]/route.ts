import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z
  .object({
    role: z
      .enum(["requester", "dispatcher", "responder", "admin", "auditor", "support"])
      .optional(),
    status: z
      .enum(["pending", "active", "suspended", "locked", "deactivated"])
      .optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "No valid changes were supplied.",
  });

export const PATCH = createHandler(
  {
    name: "admin.user.update",
    auth: "required",
    roles: ["admin"],
    params: paramsSchema,
    body: bodySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_user_updated",
      targetType: "user",
    },
  },
  async (ctx) => {
    if (ctx.user.userId === ctx.params.id) {
      throw new ApiError(
        "BAD_REQUEST",
        "You cannot modify your own role or account status.",
      );
    }

    const updates = {
      ...ctx.body,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db()
      .from("users")
      .update(updates)
      .eq("id", ctx.params.id)
      .is("deleted_at", null)
      .select("id,email,phone,role,status,first_name,last_name,display_name,created_at")
      .single();

    if (error) {
      throw ApiError.internal("Unable to update the user.", error.message);
    }

    ctx.audit({
      targetId: ctx.params.id,
      changedRole: ctx.body.role ?? null,
      changedStatus: ctx.body.status ?? null,
    });

    return { user: data };
  },
);
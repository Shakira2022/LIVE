import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const organisationEditSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  organisation_type: z.enum(["medical", "firefighter", "police"]).optional(),
  registration_number: z.string().trim().max(80).nullable().optional(),
  contact_email: z.string().trim().email().max(255).or(z.literal("")).nullable().optional(),
  contact_phone: z.string().trim().max(32).or(z.literal("")).nullable().optional(),
  address_line_1: z.string().trim().min(3).max(200).optional(),
  address_line_2: z.string().trim().max(200).nullable().optional(),
  suburb: z.string().trim().max(100).nullable().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  province: z.string().trim().min(2).max(100).optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  service_area_description: z.string().trim().min(3).max(1000).optional(),
  latitude: z.number().min(-35).max(-22).optional(),
  longitude: z.number().min(16).max(33).optional(),
  status: z.enum(["active", "pending", "paused"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one organisation field to update.")
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), "Latitude and longitude must be updated together.");

export const PATCH = createHandler(
  {
    name: "admin.organisation.update",
    auth: "required",
    roles: ["admin"],
    params: paramsSchema,
    body: organisationEditSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_organisation_updated",
      targetType: "organisation",
    },
  },
  async (ctx) => {
    const { data, error } = await db()
      .from("organisations")
      .update({
        ...ctx.body,
        ...(ctx.body.contact_email !== undefined ? { contact_email: ctx.body.contact_email || null } : {}),
        ...(ctx.body.contact_phone !== undefined ? { contact_phone: ctx.body.contact_phone || null } : {}),
        ...(ctx.body.registration_number !== undefined ? { registration_number: ctx.body.registration_number || null } : {}),
        ...(ctx.body.address_line_2 !== undefined ? { address_line_2: ctx.body.address_line_2 || null } : {}),
        ...(ctx.body.suburb !== undefined ? { suburb: ctx.body.suburb || null } : {}),
        ...(ctx.body.postal_code !== undefined ? { postal_code: ctx.body.postal_code || null } : {}),
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
      fields: Object.keys(ctx.body),
    });

    return { organisation: data };
  },
);

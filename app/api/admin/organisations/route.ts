import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.organisations",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const { data, error } = await db()
      .from("organisations")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw ApiError.internal("Unable to retrieve organisations.", error.message);
    }

    return { organisations: data ?? [] };
  },
);

const organisationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  organisation_type: z.enum(["medical", "firefighter", "police"]),
  registration_number: z.string().trim().max(80).optional().nullable(),
  contact_email: z.string().trim().email().max(255).optional().or(z.literal("")),
  contact_phone: z.string().trim().max(32).optional().or(z.literal("")),
  address_line_1: z.string().trim().min(3).max(200),
  address_line_2: z.string().trim().max(200).optional().or(z.literal("")),
  suburb: z.string().trim().max(100).optional().or(z.literal("")),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(100),
  postal_code: z.string().trim().max(20).optional().or(z.literal("")),
  service_area_description: z.string().trim().min(3).max(1000),
  latitude: z.number().min(-35).max(-22),
  longitude: z.number().min(16).max(33),
  status: z.enum(["active", "pending", "paused"]),
});

export const POST = createHandler(
  {
    name: "admin.organisation.create",
    auth: "required",
    roles: ["admin"],
    body: organisationSchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
    audit: { action: "admin_organisation_created", targetType: "organisation" },
    successStatus: 201,
  },
  async (ctx) => {
    const { data: duplicate, error: duplicateError } = await db()
      .from("organisations")
      .select("id")
      .ilike("name", ctx.body.name)
      .maybeSingle();
    if (duplicateError) throw ApiError.internal("Unable to check the organisation name.", duplicateError.message);
    if (duplicate) throw new ApiError("CONFLICT", "An organisation with this name already exists.");

    const { data, error } = await db()
      .from("organisations")
      .insert({
        ...ctx.body,
        registration_number: ctx.body.registration_number || null,
        contact_email: ctx.body.contact_email || null,
        contact_phone: ctx.body.contact_phone || null,
        address_line_2: ctx.body.address_line_2 || null,
        suburb: ctx.body.suburb || null,
        postal_code: ctx.body.postal_code || null,
        country_code: "ZA",
      })
      .select("*")
      .single();
    if (error) throw ApiError.internal("Unable to create the organisation.", error.message);
    ctx.audit({ targetId: data.id, organisationType: data.organisation_type });
    return { organisation: data };
  },
);

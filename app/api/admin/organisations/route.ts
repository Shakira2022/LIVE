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

/*
 * Forms send empty strings for blank fields. Turn those into null so the
 * optional database columns stay empty instead of storing "".
 */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().min(min).max(max).optional(),
  );

/*
 * Keys match the column names in the organisations table.
 * Required columns with no database default: name, organisation_type
 * and service_area_description.
 */
const createBodySchema = z.object({
  name: z.string().trim().min(2, "Enter the organisation name.").max(120),
  organisation_type: z.string().trim().min(1, "Choose an organisation type."),
  service_area_description: z
    .string()
    .trim()
    .min(5, "Describe the service area.")
    .max(1000),
  status: z
    .enum(["pending", "active", "paused", "suspended", "closed"])
    .optional(),
  registration_number: optionalText(60),
  contact_email: z.preprocess(
    blankToNull,
    z.string().trim().email("Enter a valid email address.").max(254).nullable().optional(),
  ),
  contact_phone: optionalText(30),
  address_line_1: optionalText(150),
  address_line_2: optionalText(150),
  suburb: optionalText(100),
  city: optionalText(100),
  province: optionalText(100),
  postal_code: optionalText(10),
  country_code: z
    .string()
    .trim()
    .length(2, "Use a 2 letter country code.")
    .transform((value) => value.toUpperCase())
    .optional(),
  latitude: optionalNumber(-90, 90),
  longitude: optionalNumber(-180, 180),
});

export const POST = createHandler(
  {
    name: "admin.organisation.create",
    auth: "required",
    roles: ["admin"],
    body: createBodySchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_organisation_created",
      targetType: "organisation",
    },
  },
  async (ctx) => {
    const { data, error } = await db()
      .from("organisations")
      .insert(ctx.body)
      .select("*")
      .single();

    if (error) {
      console.error("Organisation create failed:", error.message);

      throw ApiError.internal(
        "Unable to create the organisation.",
        error.message,
      );
    }

    ctx.audit({
      targetId: data.id,
      newStatus: data.status,
    });

    return { organisation: data };
  },
);
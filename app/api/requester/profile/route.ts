import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db, isUniqueViolation } from "@/lib/middleware/server/db";
import { southAfricanPhoneSchema } from "@/lib/middleware/validation";

export const runtime = "nodejs";

const requiredPhone = southAfricanPhoneSchema;
const bodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: requiredPhone,
  emergencyContactName: z.string().trim().min(1, "Enter an emergency contact name.").max(160),
  emergencyContactPhone: requiredPhone,
  medicalConditions: z.string().trim().min(1, "Enter your medical conditions, or type None.").max(2000),
  allergies: z.string().trim().min(1, "Enter your allergies, or type None.").max(2000),
  medications: z.string().trim().min(1, "Enter your medications, or type None.").max(2000),
}).refine(
  (body) => Boolean(body.emergencyContactName) === Boolean(body.emergencyContactPhone),
  { message: "Enter both emergency contact fields, or leave both blank." },
);

export const GET = createHandler(
  { name: "requester.profile.read", auth: "required", roles: ["requester"] },
  async (ctx) => {
    const { data, error } = await db()
      .from("requester_medical_details")
      .select("conditions, allergies, medications")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to load your medical details.", error.message);
    return {
      medicalConditions: data?.conditions ?? "",
      allergies: data?.allergies ?? "",
      medications: data?.medications ?? "",
    };
  },
);

export const PATCH = createHandler(
  {
    name: "requester.profile.update",
    auth: "required",
    roles: ["requester"],
    body: bodySchema,
    rateLimit: { limit: 10, windowMs: 60_000, by: "user" },
    audit: { action: "requester_profile_updated", targetType: "user" },
  },
  async (ctx) => {
    const [firstName, ...lastNameParts] = ctx.body.name.split(/\s+/);
    const lastName = lastNameParts.join(" ");
    const client = db();

    const { error: userError } = await client
      .from("users")
      .update({
        first_name: firstName,
        last_name: lastName,
        display_name: ctx.body.name,
        phone: ctx.body.phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.user.userId)
      .is("deleted_at", null);

    if (isUniqueViolation(userError)) {
      throw new ApiError("CONFLICT", "That phone number is already used by another account.");
    }
    if (userError) throw ApiError.internal("Unable to update your profile.", userError.message);

    const { error: medicalError } = await client.from("requester_medical_details").upsert({
      user_id: ctx.user.userId,
      conditions: ctx.body.medicalConditions,
      allergies: ctx.body.allergies,
      medications: ctx.body.medications,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (medicalError?.code === "42P01") {
      throw ApiError.internal("Medical details storage is not set up. Apply migration 0011_requester_medical_details.sql.", medicalError.message);
    }
    if (medicalError) throw ApiError.internal("Unable to save your medical details.", medicalError.message);

    const { data: primaryContact, error: contactReadError } = await client
      .from("emergency_contacts")
      .select("id")
      .eq("user_id", ctx.user.userId)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle();
    if (contactReadError) throw ApiError.internal("Unable to load your emergency contact.", contactReadError.message);

    if (ctx.body.emergencyContactName && ctx.body.emergencyContactPhone) {
      const contactValues = {
        full_name: ctx.body.emergencyContactName,
        phone: ctx.body.emergencyContactPhone,
        is_primary: true,
      };
      const { error: contactError } = primaryContact
        ? await client.from("emergency_contacts").update(contactValues).eq("id", primaryContact.id).eq("user_id", ctx.user.userId)
        : await client.from("emergency_contacts").insert({ ...contactValues, user_id: ctx.user.userId });
      if (contactError) throw ApiError.internal("Unable to update your emergency contact.", contactError.message);
    } else if (primaryContact) {
      const { error: deleteError } = await client
        .from("emergency_contacts")
        .delete()
        .eq("id", primaryContact.id)
        .eq("user_id", ctx.user.userId);
      if (deleteError) throw ApiError.internal("Unable to remove your emergency contact.", deleteError.message);
    }

    return { saved: true };
  },
);

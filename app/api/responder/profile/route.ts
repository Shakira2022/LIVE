import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db, isUniqueViolation } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(1).max(32).regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Enter a valid callback number."),
});

export const PATCH = createHandler(
  {
    name: "responder.profile.update",
    auth: "required",
    roles: ["responder"],
    body: bodySchema,
    rateLimit: { limit: 10, windowMs: 60_000, by: "user" },
    audit: { action: "responder_profile_updated", targetType: "user" },
  },
  async (ctx) => {
    const [firstName, ...lastNameParts] = ctx.body.name.split(/\s+/);
    const { error } = await db()
      .from("users")
      .update({
        first_name: firstName,
        last_name: lastNameParts.join(" "),
        display_name: ctx.body.name,
        phone: ctx.body.phone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.user.userId)
      .is("deleted_at", null);

    if (isUniqueViolation(error)) throw new ApiError("CONFLICT", "That phone number is already used by another account.");
    if (error) throw ApiError.internal("Unable to update your profile.", error.message);
    return { saved: true };
  },
);

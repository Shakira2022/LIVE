import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { CURRENT_TERMS_VERSION } from "@/lib/legal-terms";

export const runtime = "nodejs";

const bodySchema = z.object({
  version: z.literal(CURRENT_TERMS_VERSION),
});

export const POST = createHandler(
  {
    name: "user.terms.accept",
    auth: "required",
    body: bodySchema,
    rateLimit: { limit: 5, windowMs: 60_000, by: "user" },
    audit: { action: "user_terms_accepted", targetType: "user" },
  },
  async (ctx) => {
    const acceptedAt = new Date().toISOString();
    const { data, error } = await db()
      .from("users")
      .update({
        terms_accepted_at: acceptedAt,
        terms_accepted_version: ctx.body.version,
      })
      .eq("id", ctx.user.userId)
      .is("deleted_at", null)
      .select("terms_accepted_at, terms_accepted_version")
      .single();

    if (error?.code === "42703") {
      throw ApiError.internal(
        "Terms acceptance storage is not set up. Apply migration 0013_user_terms_acceptance.sql.",
        error.message,
      );
    }
    if (error || !data) throw ApiError.internal("Unable to save your terms acceptance.", error?.message);

    return {
      acceptedAt: data.terms_accepted_at as string,
      version: data.terms_accepted_version as string,
    };
  },
);

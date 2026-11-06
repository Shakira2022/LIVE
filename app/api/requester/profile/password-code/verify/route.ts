import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { hashRequesterPasswordCode } from "@/lib/requester-password-code";

export const runtime = "nodejs";

const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the six-digit code from your email.") });

export const POST = createHandler(
  {
    name: "account.profile.password_code.verify",
    auth: "required",
    roles: ["requester", "responder", "dispatcher", "auditor"],
    body: bodySchema,
    rateLimit: { limit: 10, windowMs: 15 * 60_000, by: "user" },
    audit: { action: "account_password_code_verified", targetType: "user" },
  },
  async (ctx) => {
    const client = db();
    const { data, error } = await client
      .from("requester_password_change_codes")
      .select("id")
      .eq("user_id", ctx.user.userId)
      .eq("code_hash", hashRequesterPasswordCode(ctx.body.code))
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to verify the code.", error.message);
    if (!data) throw new ApiError("BAD_REQUEST", "That code is incorrect or has expired. Request a new code and try again.");

    const { error: markError } = await client
      .from("requester_password_change_codes")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", ctx.user.userId)
      .is("used_at", null);
    if (markError) throw ApiError.internal("Unable to confirm the code.", markError.message);
    return { verified: true };
  },
);

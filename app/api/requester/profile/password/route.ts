import bcrypt from "bcryptjs";
import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { passwordSchema } from "@/lib/middleware/validation";
import { db } from "@/lib/middleware/server/db";
import { hashRequesterPasswordCode } from "@/lib/requester-password-code";

export const runtime = "nodejs";

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema,
});

export const POST = createHandler(
  {
    name: "account.profile.password.update",
    auth: "required",
    roles: ["requester", "responder", "dispatcher", "auditor"],
    body: bodySchema,
    rateLimit: { limit: 5, windowMs: 15 * 60_000, by: "user" },
    audit: { action: "account_password_changed", targetType: "user" },
  },
  async (ctx) => {
    const client = db();
    const { data: code, error: codeError } = await client
      .from("requester_password_change_codes")
      .select("id")
      .eq("user_id", ctx.user.userId)
      .eq("code_hash", hashRequesterPasswordCode(ctx.body.code))
      .not("verified_at", "is", null)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (codeError) throw ApiError.internal("Unable to validate the password code.", codeError.message);
    if (!code) throw new ApiError("BAD_REQUEST", "That code is incorrect, expired, or already used. Request a new code.");

    const { data: consumed, error: consumeError } = await client
      .from("requester_password_change_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", code.id)
      .eq("user_id", ctx.user.userId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();

    if (consumeError) throw ApiError.internal("Unable to secure the password code.", consumeError.message);
    if (!consumed) throw new ApiError("CONFLICT", "That code has expired or was already used. Request a new code.");

    const passwordHash = await bcrypt.hash(ctx.body.newPassword, 12);
    const { error: updateError } = await client
      .from("users")
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq("id", ctx.user.userId)
      .is("deleted_at", null);

    if (updateError) throw ApiError.internal("Unable to update your password. Request a new code and try again.", updateError.message);
    return { changed: true };
  },
);

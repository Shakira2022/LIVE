import { randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { hashRequesterPasswordCode } from "@/lib/requester-password-code";
import { escapeEmailHtml, liveEmailLayout } from "@/lib/email-template";

export const runtime = "nodejs";

export const POST = createHandler(
  {
    name: "account.profile.password_code",
    auth: "required",
    roles: ["requester", "responder", "dispatcher", "auditor"],
    body: z.object({}).optional(),
    rateLimit: { limit: 3, windowMs: 15 * 60_000, by: "user" },
    audit: { action: "account_password_code_requested", targetType: "user" },
  },
  async (ctx) => {
    const client = db();
    const { data: user, error: userError } = await client
      .from("users")
      .select("email, first_name, display_name")
      .eq("id", ctx.user.userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (userError) throw ApiError.internal("Unable to load the account email.", userError.message);
    if (!user?.email) throw new ApiError("BAD_REQUEST", "Add an email address to your account before changing your password.");

    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailAppPassword) throw ApiError.internal("Email service is not configured.");

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hashRequesterPasswordCode(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);

    const { error: clearError } = await client
      .from("requester_password_change_codes")
      .delete()
      .eq("user_id", ctx.user.userId)
      .is("used_at", null);
    if (clearError) throw ApiError.internal("Unable to prepare a password verification code.", clearError.message);

    const { error: insertError } = await client.from("requester_password_change_codes").insert({
      user_id: ctx.user.userId,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    });
    if (insertError) throw ApiError.internal("Unable to create a password verification code.", insertError.message);

    const displayName = user.display_name?.trim() || user.first_name?.trim() || "there";
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailAppPassword } });
    try {
      await transporter.sendMail({
        from: `"LIVE" <${gmailUser}>`,
        to: user.email,
        subject: "Your LIVE password change code",
        text: `Hello ${displayName},\n\nUse this code to change your LIVE password: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.\n\nThe LIVE Team`,
        html: liveEmailLayout(`<div style="margin-bottom:20px;border-left:3px solid #0f6872;padding-left:12px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0f6872">Account security</div><h1 style="margin:0;font-size:30px;line-height:1.15;color:#102b3f">Password change code</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#607482">Hello ${escapeEmailHtml(displayName)},<br><br>Use this code to change your LIVE password:</p><div style="margin-top:24px;padding:18px 20px;background:#f5f7f9;text-align:center;font-size:28px;font-weight:700;letter-spacing:8px;color:#102b3f">${code}</div><p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#71838e">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`, "Your LIVE password change code"),
      });
    } catch (error) {
      await client.from("requester_password_change_codes").delete().eq("code_hash", codeHash);
      throw ApiError.internal("Unable to send the password verification email.", error instanceof Error ? error.message : undefined);
    }

    return { sent: true, email: user.email, expiresInMinutes: 10 };
  },
);

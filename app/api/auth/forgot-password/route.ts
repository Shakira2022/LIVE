import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateResetToken } from "@/lib/reset-token";

function getApplicationOrigin(request: NextRequest) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        {
          error: "Email is required.",
        },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find the user
    const { data: user, error: userError } =
      await supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, display_name")
        .eq("email", cleanEmail)
        .maybeSingle();

    if (userError) {
      console.error(
        "FORGOT PASSWORD USER LOOKUP ERROR:",
        userError
      );

      return NextResponse.json(
        {
          error: "Something went wrong.",
        },
        { status: 500 }
      );
    }

    // If the email does not exist
    if (!user) {
      return NextResponse.json(
        {
          error: "No account exists with this email address.",
        },
        { status: 404 }
      );
    }

    // Generate secure reset token
    const { rawToken, tokenHash } =
      generateResetToken();

    // Token expires after 30 minutes
    const expiryMinutes = Number(
      process.env.RESET_TOKEN_EXPIRY_MINUTES ?? 30
    );

    const expiresAt = new Date(
      Date.now() +
        expiryMinutes * 60 * 1000
    );

    // Store the HASHED token in the database
    const { error: insertError } =
      await supabaseAdmin
        .from("password_recovery_tokens")
        .insert({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString(),
        });

    if (insertError) {
      console.error(
        "FAILED TO CREATE RESET TOKEN:",
        insertError
      );

      return NextResponse.json(
        {
          error:
            "Something went wrong while creating the password recovery request.",
        },
        { status: 500 }
      );
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailAppPassword) {
      await supabaseAdmin.from("password_recovery_tokens").delete().eq("token_hash", tokenHash);
      return NextResponse.json({ error: "Email service is not configured." }, { status: 500 });
    }

    const displayName = user.display_name || `${user.first_name} ${user.last_name}`.trim() || "there";
    const resetUrl = `${getApplicationOrigin(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
    });

    try {
      await transporter.sendMail({
        from: `"LIVE" <${gmailUser}>`,
        to: cleanEmail,
        subject: "Reset your LIVE password",
        text: `Hello ${displayName},\n\nWe received a request to reset your LIVE password.\n\nReset your password: ${resetUrl}\n\nThis link expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email.\n\nThe LIVE Team`,
        html: `<!doctype html><html lang="en"><body style="margin:0;background:#f4f7f9;font-family:Arial,sans-serif;color:#102b3f"><div style="max-width:560px;margin:40px auto;padding:32px;background:#fff;border:1px solid #dce5ea;border-radius:16px"><p style="color:#0f6872;font-weight:700;letter-spacing:2px">LIVE</p><h1>Reset your password</h1><p>Hello ${displayName},</p><p>We received a request to reset your LIVE password.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#0f5b67;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p style="color:#667b89;font-size:14px">This link expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email.</p><p>The LIVE Team</p></div></body></html>`,
      });
    } catch (emailError) {
      await supabaseAdmin.from("password_recovery_tokens").delete().eq("token_hash", tokenHash);
      console.error("PASSWORD RESET EMAIL ERROR:", emailError);
      return NextResponse.json({ error: "Unable to send the password reset email." }, { status: 500 });
    }

    return NextResponse.json({
      message:
        "Password reset instructions have been sent to your email.",
    });
  } catch (error) {
    console.error(
      "FORGOT PASSWORD ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while processing your request.",
      },
      { status: 500 }
    );
  }
}

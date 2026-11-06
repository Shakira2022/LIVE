import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateResetToken } from "@/lib/reset-token";
import { escapeEmailHtml, liveEmailButton, liveEmailLayout } from "@/lib/email-template";

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
        html: liveEmailLayout(`<div style="margin-bottom:20px;border-left:3px solid #0f6872;padding-left:12px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0f6872">Account security</div><h1 style="margin:0;font-size:30px;line-height:1.15;color:#102b3f">Reset your password</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#607482">Hello ${escapeEmailHtml(displayName)},<br><br>We received a request to reset your LIVE password.</p>${liveEmailButton(resetUrl, "Reset password")}<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#71838e">This link expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email.</p><p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#71838e">If the button does not work, copy this link into your browser:<br><a href="${escapeEmailHtml(resetUrl)}" style="color:#0f6872;word-break:break-all">${escapeEmailHtml(resetUrl)}</a></p>`, "Reset your LIVE password"),
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

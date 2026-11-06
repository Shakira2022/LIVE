import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateResetToken } from "@/lib/reset-token";
import { logApplicationEvent } from "@/lib/application-logger";
import { logIntegrationEvent } from "@/lib/integration-logger";
import { escapeEmailHtml, liveEmailButton, liveEmailLayout } from "@/lib/email-template";

function getApplicationOrigin(request: NextRequest) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
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

    // ---------------------------------------------------------
    // Find user
    // ---------------------------------------------------------

    const { data: user, error: userError } =
      await supabaseAdmin
        .from("users")
        .select(
          "id, first_name, last_name, display_name, email_verified_at"
        )
        .eq("email", cleanEmail)
        .maybeSingle();

    if (userError) {
      console.error(
        "RESEND VERIFICATION USER LOOKUP ERROR:",
        userError
      );

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "RESEND_VERIFICATION_USER_LOOKUP_ERROR",
        message:
          "Unable to find user for verification email resend.",
        error_code: userError.code,
      });

      return NextResponse.json(
        {
          error: "Something went wrong.",
        },
        { status: 500 }
      );
    }

    if (!user) {
      await logApplicationEvent({
        level: "warning",
        service_name: "auth",
        event_name: "RESEND_VERIFICATION_USER_NOT_FOUND",
        message:
          "Verification email resend requested for an unknown email address.",
      });

      return NextResponse.json(
        {
          error:
            "No account exists with this email address.",
        },
        { status: 404 }
      );
    }

    // ---------------------------------------------------------
    // Check verification status
    // ---------------------------------------------------------

    if (user.email_verified_at) {
      await logApplicationEvent({
        level: "info",
        service_name: "auth",
        event_name:
          "RESEND_VERIFICATION_ALREADY_VERIFIED",
        message:
          "Verification resend requested for an already verified account.",
        safe_context: {
          user_id: user.id,
        },
      });

      return NextResponse.json(
        {
          error:
            "This email address is already verified.",
        },
        { status: 409 }
      );
    }

    // ---------------------------------------------------------
    // Generate verification token
    // ---------------------------------------------------------

    const { rawToken, tokenHash } =
      generateResetToken();

    const expiryMinutes = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES ?? 30);

    const expiresAt = new Date(
      Date.now() +
        expiryMinutes * 60 * 1000
    );
    const verificationUrl = `${getApplicationOrigin(req)}/verify-email?token=${encodeURIComponent(rawToken)}`;

    // ---------------------------------------------------------
    // Store hashed token
    // ---------------------------------------------------------

    const { error: tokenError } =
      await supabaseAdmin
        .from("email_verification_tokens")
        .insert({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt.toISOString(),
        });

    if (tokenError) {
      console.error(
        "RESEND VERIFICATION TOKEN ERROR:",
        tokenError
      );

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "RESEND_VERIFICATION_TOKEN_ERROR",
        message:
          "Unable to create email verification token.",
        error_code: tokenError.code,
        safe_context: {
          user_id: user.id,
        },
      });

      return NextResponse.json(
        {
          error:
            "Unable to create verification request.",
        },
        { status: 500 }
      );
    }

    // ---------------------------------------------------------
    // Create Gmail transporter
    // ---------------------------------------------------------

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // ---------------------------------------------------------
    // Verify SMTP connection
    // ---------------------------------------------------------

    const smtpStart = Date.now();

    try {
      await transporter.verify();

      await logIntegrationEvent({
        provider_name: "Gmail",
        operation: "SMTP_VERIFY",
        endpoint_name: "smtp.gmail.com",
        result: "success",
        duration_ms:
          Date.now() - smtpStart,
        safe_request_metadata: {
          protocol: "SMTP",
          port: 587,
        },
        safe_response_metadata: {
          verified: true,
        },
      });
    } catch (smtpError) {
      console.error(
        "GMAIL SMTP VERIFICATION ERROR:",
        smtpError
      );

      await logIntegrationEvent({
        provider_name: "Gmail",
        operation: "SMTP_VERIFY",
        endpoint_name: "smtp.gmail.com",
        result: "failure",
        duration_ms:
          Date.now() - smtpStart,
        error_message:
          smtpError instanceof Error
            ? smtpError.message
            : "SMTP verification failed.",
      });

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "VERIFICATION_SMTP_CONNECTION_FAILED",
        message:
          "Gmail SMTP connection failed while sending verification email.",
        safe_context: {
          user_id: user.id,
        },
      });

      return NextResponse.json(
        {
          error:
            "Unable to connect to the email service.",
        },
        { status: 500 }
      );
    }

    // ---------------------------------------------------------
    // Send verification email
    // ---------------------------------------------------------

    const emailStart = Date.now();

    const displayName =
      user.display_name ||
      `${user.first_name} ${user.last_name}`;

    try {
      await transporter.sendMail({
        from: `"LIVE" <${process.env.GMAIL_USER}>`,
        to: cleanEmail,
        subject:
          "Your LIVE verification code",

        text: `Hello ${displayName},\n\nYou requested a new LIVE email verification code.\n\nYour verification code is:\n${rawToken}\n\nThis code expires in ${expiryMinutes} minutes.\n\nVerify your email using this link: ${verificationUrl}\n\nIf you did not request this verification email, you can safely ignore it.\n\nThank you,\nThe LIVE Team`,

        html: liveEmailLayout(`<div style="margin-bottom:20px;border-left:3px solid #0f6872;padding-left:12px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0f6872">Email verification</div><h1 style="margin:0;font-size:30px;line-height:1.15;color:#102b3f">Verify your email</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#607482">Hello ${escapeEmailHtml(displayName)},<br><br>You requested a new LIVE email verification code.</p><div style="margin-top:24px;padding:18px 20px;background:#f5f7f9;text-align:center;font-size:18px;font-weight:700;letter-spacing:1px;color:#102b3f;word-break:break-all">${escapeEmailHtml(rawToken)}</div>${liveEmailButton(verificationUrl, "Verify email")}<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#71838e">This code and link expire in ${expiryMinutes} minutes.</p><p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#71838e">If the button does not work, copy this link into your browser:<br><a href="${escapeEmailHtml(verificationUrl)}" style="color:#0f6872;word-break:break-all">${escapeEmailHtml(verificationUrl)}</a></p><div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe6ea;font-size:12px;line-height:1.7;color:#71838e">If you did not request this verification email, you can safely ignore it.</div>`, "Your LIVE verification code"),
      });

      // -------------------------------------------------------
      // Integration log - successful email
      // -------------------------------------------------------

      await logIntegrationEvent({
        provider_name: "Gmail",
        operation:
          "SEND_VERIFICATION_EMAIL",
        endpoint_name: "smtp.gmail.com",
        result: "success",
        duration_ms:
          Date.now() - emailStart,
        safe_request_metadata: {
          protocol: "SMTP",
          port: 587,
          recipient_type: "user_email",
        },
        safe_response_metadata: {
          email_sent: true,
        },
      });

      // -------------------------------------------------------
      // Application log - successful resend
      // -------------------------------------------------------

      await logApplicationEvent({
        level: "info",
        service_name: "auth",
        event_name:
          "VERIFICATION_EMAIL_RESENT",
        message:
          "Verification email was resent successfully.",
        safe_context: {
          user_id: user.id,
        },
      });

    } catch (emailError) {
      console.error(
        "VERIFICATION EMAIL SEND ERROR:",
        emailError
      );

      // -------------------------------------------------------
      // Integration log - email failure
      // -------------------------------------------------------

      await logIntegrationEvent({
        provider_name: "Gmail",
        operation:
          "SEND_VERIFICATION_EMAIL",
        endpoint_name: "smtp.gmail.com",
        result: "failure",
        duration_ms:
          Date.now() - emailStart,
        error_message:
          emailError instanceof Error
            ? emailError.message
            : "Verification email could not be sent.",
      });

      // -------------------------------------------------------
      // Application log - email failure
      // -------------------------------------------------------

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "VERIFICATION_EMAIL_RESEND_FAILED",
        message:
          "Verification email could not be sent.",
        safe_context: {
          user_id: user.id,
        },
      });

      return NextResponse.json(
        {
          error:
            "Unable to send verification email.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message:
          "A new verification email has been sent.",
      },
      { status: 200 }
    );

  } catch (error) {
    console.error(
      "RESEND VERIFICATION ERROR:",
      error
    );

    await logApplicationEvent({
      level: "critical",
      service_name: "auth",
      event_name:
        "RESEND_VERIFICATION_ERROR",
      message:
        "Unexpected error occurred while resending verification email.",
    });

    return NextResponse.json(
      {
        error:
          "Something went wrong while resending the verification email.",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateResetToken } from "@/lib/reset-token";
import { logApplicationEvent } from "@/lib/application-logger";
import { logIntegrationEvent } from "@/lib/integration-logger";

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

    const expiryMinutes = Number(
      process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES ??
        30
    );

    const expiresAt = new Date(
      Date.now() +
        expiryMinutes * 60 * 1000
    );

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

        text: `
Hello ${displayName},

You requested a new LIVE email verification code.

Your verification code is:

${rawToken}

This code expires in ${expiryMinutes} minutes.

If you did not request this verification email, you can safely ignore it.

Thank you,
The LIVE Team
        `,

        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>LIVE Email Verification</title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background:#f4f7f9;
    font-family:Arial, sans-serif;
  "
>
  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    style="padding:40px 0;"
  >
    <tr>
      <td align="center">

        <table
          width="600"
          cellpadding="0"
          cellspacing="0"
          style="
            background:#ffffff;
            border-radius:10px;
            overflow:hidden;
          "
        >

          <tr>
            <td
              style="
                background:#102b3f;
                color:#ffffff;
                padding:25px;
                text-align:center;
              "
            >
              <h1 style="margin:0;">
                LIVE
              </h1>
            </td>
          </tr>

          <tr>
            <td
              style="
                padding:40px;
                color:#333333;
              "
            >

              <h2>
                Verify Your Email
              </h2>

              <p>
                Hello ${displayName},
              </p>

              <p>
                You requested a new verification
                code for your LIVE account.
              </p>

              <p>
                Your verification code is:
              </p>

              <div
                style="
                  margin:25px 0;
                  padding:20px;
                  background:#eef3f6;
                  border-radius:8px;
                  text-align:center;
                  font-size:28px;
                  font-weight:bold;
                  letter-spacing:3px;
                  color:#102b3f;
                  word-break:break-all;
                "
              >
                ${rawToken}
              </div>

              <p>
                This code expires in
                ${expiryMinutes} minutes.
              </p>

              <p>
                If you did not request this verification
                email, you can safely ignore it.
              </p>

            </td>
          </tr>

          <tr>
            <td
              style="
                padding:20px;
                text-align:center;
                color:#9aa7b0;
                font-size:12px;
              "
            >
              &copy; ${new Date().getFullYear()}
              LIVE. All rights reserved.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
        `,
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
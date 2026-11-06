import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { createHash, randomUUID } from "crypto";
import { logApplicationEvent } from "@/lib/application-logger";
import { logIntegrationEvent } from "@/lib/integration-logger";
import { escapeEmailHtml, liveEmailButton, liveEmailLayout } from "@/lib/email-template";

export const runtime = "nodejs";

/* ============================================================
   SUPABASE
   ============================================================ */

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is not configured."
  );
}

if (!serviceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not configured."
  );
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/* ============================================================
   HELPERS
   ============================================================ */

function errorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      ok: false,
      message,
    },
    {
      status,
    }
  );
}

function normalizeText(
  value: unknown
) {
  return String(value ?? "").trim();
}

function normalizeEmail(
  value: unknown
) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function hashVerificationToken(
  token: string
) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

/*
 * We normally use the URL of the incoming registration
 * request so this works locally, through ngrok and in
 * production.
 *
 * You can override it with APP_URL if needed.
 */
function getApplicationOrigin(
  request: Request
) {
  const configured =
    process.env.APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedHost =
    request.headers.get(
      "x-forwarded-host"
    );

  const host =
    forwardedHost ||
    request.headers.get("host");

  const forwardedProtocol =
    request.headers.get(
      "x-forwarded-proto"
    );

  const protocol =
    forwardedProtocol ||
    (host?.includes("localhost")
      ? "http"
      : "https");

  if (host) {
    return `${protocol}://${host}`;
  }

  return new URL(request.url).origin;
}

/* ============================================================
   REGISTER
   ============================================================ */

export async function POST(
  request: Request
) {
  let createdUserId:
    | string
    | null = null;

  /*
   * One correlation ID is created for this entire registration attempt.
   * Every application log written below reuses this same value so an
   * auditor can trace the full workflow end-to-end.
   */
  const correlationId =
    randomUUID();

  try {
    /* ========================================================
       BODY
       ======================================================== */

    const body =
      await request.json();

    const {
      name,
      email,
      phone,
      emergencyContactName,
      emergencyContactPhone,
      password,
    } = body ?? {};

    /* ========================================================
       REQUIRED FIELDS
       ======================================================== */

    if (
      !name ||
      !email ||
      !phone ||
      !emergencyContactName ||
      !emergencyContactPhone ||
      !password
    ) {
      return errorResponse(
        "All fields are required.",
        400
      );
    }

    /* ========================================================
       NORMALIZE
       ======================================================== */

    const cleanName =
      normalizeText(name);

    const cleanEmail =
      normalizeEmail(email);

    const cleanPhone =
      normalizeText(phone);

    const cleanEmergencyContactName =
      normalizeText(
        emergencyContactName
      );

    const cleanEmergencyContactPhone =
      normalizeText(
        emergencyContactPhone
      );

    const cleanPassword =
      String(password);

    /* ========================================================
       NAME
       ======================================================== */

    const nameParts =
      cleanName
        .split(/\s+/)
        .filter(Boolean);

    if (nameParts.length < 2) {
      return errorResponse(
        "Please enter your first name and surname.",
        400
      );
    }

    const firstName =
      nameParts[0];

    const lastName =
      nameParts
        .slice(1)
        .join(" ");

    /* ========================================================
       EMAIL
       ======================================================== */

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !emailPattern.test(
        cleanEmail
      )
    ) {
      return errorResponse(
        "Please enter a valid email address.",
        400
      );
    }

    /* ========================================================
       PASSWORD
       ======================================================== */

    if (
      cleanPassword.length < 8
    ) {
      return errorResponse(
        "Password must be at least 8 characters.",
        400
      );
    }

    /* ========================================================
       DUPLICATE EMAIL
       ======================================================== */

    const {
      data: existingEmail,
      error: emailError,
    } = await supabase
      .from("users")
      .select("id")
      .eq(
        "email",
        cleanEmail
      )
      .is(
        "deleted_at",
        null
      )
      .maybeSingle();

    if (emailError) {
      console.error(
        "EMAIL CHECK ERROR:",
        emailError
      );

      return errorResponse(
        "Unable to check existing account.",
        500
      );
    }

    if (existingEmail) {
      await logApplicationEvent({
        level: "warning",
        service_name: "auth",
        event_name:
          "REGISTRATION_EMAIL_EXISTS",
        message:
          "Registration rejected because email already exists.",
        correlation_id:
          correlationId,
        safe_context: {
          existingUserId:
            existingEmail.id,
          duplicateField:
            "email",
        },
      });

      return errorResponse(
        "An account with this email already exists.",
        409
      );
    }

    /* ========================================================
       DUPLICATE PHONE
       ======================================================== */

    const {
      data: existingPhone,
      error: phoneError,
    } = await supabase
      .from("users")
      .select("id")
      .eq(
        "phone",
        cleanPhone
      )
      .is(
        "deleted_at",
        null
      )
      .maybeSingle();

    if (phoneError) {
      console.error(
        "PHONE CHECK ERROR:",
        phoneError
      );

      return errorResponse(
        "Unable to check phone number.",
        500
      );
    }

    if (existingPhone) {
      await logApplicationEvent({
        level: "warning",
        service_name: "auth",
        event_name:
          "REGISTRATION_PHONE_EXISTS",
        message:
          "Registration rejected because phone number already exists.",
        correlation_id:
          correlationId,
        safe_context: {
          existingUserId:
            existingPhone.id,
          duplicateField:
            "phone",
        },
      });

      return errorResponse(
        "An account with this phone number already exists.",
        409
      );
    }

    /* ========================================================
       DUPLICATE NAME
       ======================================================== */

    const {
      data: existingNames,
      error: nameError,
    } = await supabase
      .from("users")
      .select("id")
      .ilike(
        "first_name",
        firstName
      )
      .ilike(
        "last_name",
        lastName
      )
      .is(
        "deleted_at",
        null
      )
      .limit(1);

    if (nameError) {
      console.error(
        "NAME CHECK ERROR:",
        nameError
      );

      return errorResponse(
        "Unable to check existing name.",
        500
      );
    }

    if (
      existingNames &&
      existingNames.length > 0
    ) {
      await logApplicationEvent({
        level: "warning",
        service_name: "auth",
        event_name:
          "REGISTRATION_NAME_EXISTS",
        message:
          "Registration rejected because a matching name already exists.",
        correlation_id:
          correlationId,
        safe_context: {
          existingUserId:
            existingNames[0]?.id ??
            null,
          duplicateField:
            "name",
        },
      });

      return errorResponse(
        "An account with this first name and surname already exists.",
        409
      );
    }

    /* ========================================================
       GMAIL
       ======================================================== */

    const gmailUser =
      process.env.GMAIL_USER;

    const gmailAppPassword =
      process.env
        .GMAIL_APP_PASSWORD;

    if (
      !gmailUser ||
      !gmailAppPassword
    ) {
      console.error(
        "GMAIL_USER or GMAIL_APP_PASSWORD is missing."
      );

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "REGISTRATION_EMAIL_SERVICE_NOT_CONFIGURED",
        message:
          "Registration could not continue because the email service is not configured.",
        correlation_id:
          correlationId,
        error_code:
          "EMAIL_SERVICE_NOT_CONFIGURED",
      });

      return errorResponse(
        "Email service is not configured.",
        500
      );
    }

    /* ========================================================
       PASSWORD HASH
       ======================================================== */

    const passwordHash =
      await bcrypt.hash(
        cleanPassword,
        12
      );

    /* ========================================================
       VERIFICATION TOKEN
       ======================================================== */

    const verificationToken =
      uuidv4();

    const verificationTokenHash =
      hashVerificationToken(
        verificationToken
      );

    const createdAt =
      new Date();

    const expiresAt =
      new Date(
        createdAt.getTime() +
          60 *
            60 *
            1000
      );

    /* ========================================================
       CREATE USER

       IMPORTANT:
       Account starts PENDING.

       Verification changes this to ACTIVE.
       ======================================================== */

    const {
      data: user,
      error: insertError,
    } = await supabase
      .from("users")
      .insert({
        first_name:
          firstName,

        last_name:
          lastName,

        display_name:
          cleanName,

        email:
          cleanEmail,

        phone:
          cleanPhone,

        password_hash:
          passwordHash,

        role:
          "requester",

        status:
          "pending",

        email_verified_at:
          null,
      })
      .select(
        `
        id,
        email,
        phone,
        role,
        status,
        first_name,
        last_name,
        display_name
        `
      )
      .single();

    if (
      insertError ||
      !user
    ) {
      console.error(
        "REGISTRATION DATABASE ERROR:",
        insertError
      );

      return errorResponse(
        "Unable to create account.",
        500
      );
    }

    createdUserId =
      user.id;

    console.log(
      "USER CREATED:",
      user.id
    );

    await logApplicationEvent({
      level: "info",
      service_name: "auth",
      event_name:
        "REGISTRATION_USER_CREATED",
      message:
        "User account was created successfully.",
      correlation_id:
        correlationId,
      safe_context: {
        userId:
          user.id,
        role:
          user.role,
        accountStatus:
          user.status,
      },
    });

    /* ========================================================
       EMERGENCY CONTACT
       ======================================================== */

    const {
      error:
        emergencyContactError,
    } = await supabase
      .from(
        "emergency_contacts"
      )
      .insert({
        user_id:
          user.id,

        full_name:
          cleanEmergencyContactName,

        phone:
          cleanEmergencyContactPhone,

        is_primary:
          true,
      });

    if (
      emergencyContactError
    ) {
      console.error(
        "EMERGENCY CONTACT ERROR:",
        emergencyContactError
      );

      await supabase
        .from("users")
        .delete()
        .eq(
          "id",
          user.id
        );

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "REGISTRATION_EMERGENCY_CONTACT_FAILED",
        message:
          "Registration failed while saving emergency contact information.",
        correlation_id:
          correlationId,
        error_code:
          emergencyContactError.code ??
          null,
        safe_context: {
          userId:
            user.id,
        },
      });

      createdUserId = null;

      return errorResponse(
        "Unable to save emergency contact information.",
        500
      );
    }

    /* ========================================================
       STORE HASHED TOKEN
       ======================================================== */

    const {
      error: tokenError,
    } = await supabase
      .from(
        "email_verification_tokens"
      )
      .insert({
        user_id:
          user.id,

        token_hash:
          verificationTokenHash,

        created_at:
          createdAt.toISOString(),

        expires_at:
          expiresAt.toISOString(),

        used_at:
          null,
      });

    if (tokenError) {
      console.error(
        "VERIFICATION TOKEN ERROR:",
        tokenError
      );

      await supabase
        .from(
          "emergency_contacts"
        )
        .delete()
        .eq(
          "user_id",
          user.id
        );

      await supabase
        .from("users")
        .delete()
        .eq(
          "id",
          user.id
        );

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "VERIFICATION_TOKEN_CREATE_FAILED",
        message:
          "Unable to create the email verification token.",
        correlation_id:
          correlationId,
        error_code:
          tokenError.code ??
          null,
        safe_context: {
          userId:
            user.id,
        },
      });

      createdUserId = null;

      return errorResponse(
        "Unable to create email verification.",
        500
      );
    }

    console.log(
      "VERIFICATION TOKEN CREATED:",
      user.id
    );

    await logApplicationEvent({
      level: "info",
      service_name: "auth",
      event_name:
        "VERIFICATION_TOKEN_CREATED",
      message:
        "Email verification token was created.",
      correlation_id:
        correlationId,
      safe_context: {
        userId:
          user.id,
        expiresAt:
          expiresAt.toISOString(),
      },
    });

    /* ========================================================
       VERIFICATION URL
       ======================================================== */

    const applicationOrigin =
      getApplicationOrigin(
        request
      );

    const verificationUrl =
      `${applicationOrigin}` +
      `/verify-email` +
      `?token=${encodeURIComponent(
        verificationToken
      )}`;

    /* ========================================================
       GMAIL TRANSPORT
       ======================================================== */

    const transporter =
      nodemailer.createTransport({
        service: "gmail",

        auth: {
          user:
            gmailUser,

          pass:
            gmailAppPassword,
        },
      });

    const smtpVerifyStartedAt =
      Date.now();

    try {
      await transporter.verify();

      const smtpVerifyDurationMs =
        Date.now() -
        smtpVerifyStartedAt;

      console.log(
        "GMAIL SMTP CONNECTION SUCCESSFUL"
      );

      await logIntegrationEvent({
        provider_name:
          "Gmail SMTP",
        operation:
          "smtp.verify",
        endpoint_name:
          "smtp.gmail.com",
        result:
          "success",
        duration_ms:
          smtpVerifyDurationMs,
        attempt_number:
          1,
        correlation_id:
          correlationId,
        safe_request_metadata: {
          userId:
            user.id,
          workflow:
            "registration_email_verification",
        },
        safe_response_metadata: {
          verified:
            true,
        },
      });
    } catch (smtpError) {
      const smtpVerifyDurationMs =
        Date.now() -
        smtpVerifyStartedAt;

      console.error(
        "GMAIL SMTP CONNECTION FAILED:",
        smtpError
      );

      await logIntegrationEvent({
        provider_name:
          "Gmail SMTP",
        operation:
          "smtp.verify",
        endpoint_name:
          "smtp.gmail.com",
        result:
          "failure",
        duration_ms:
          smtpVerifyDurationMs,
        attempt_number:
          1,
        correlation_id:
          correlationId,
        error_message:
          smtpError instanceof Error
            ? smtpError.message
            : "SMTP verification failed.",
        safe_request_metadata: {
          userId:
            user.id,
          workflow:
            "registration_email_verification",
        },
        safe_response_metadata: {
          verified:
            false,
        },
      });

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "VERIFICATION_EMAIL_TRANSPORT_FAILED",
        message:
          "Verification email transport could not be verified.",
        correlation_id:
          correlationId,
        error_code:
          smtpError instanceof Error
            ? smtpError.name
            : "SMTP_VERIFY_FAILED",
        safe_context: {
          userId:
            user.id,
        },
      });

      return errorResponse(
        "Your account was created, but the verification email could not be sent. Please try again later.",
        500
      );
    }

    /* ========================================================
       SEND EMAIL
       ======================================================== */

    const emailSendStartedAt =
      Date.now();

    try {
      await transporter.sendMail({
        from:
          `"LIVE" <${gmailUser}>`,

        to:
          cleanEmail,

        subject:
          "Verify your LIVE email address",

        /* ====================================================
           PLAIN TEXT
           ==================================================== */

        text: `
Hello ${cleanName},

Welcome to LIVE.

Please verify your email address before signing in.

Verify your email:
${verificationUrl}

This verification link expires in 1 hour.

If you did not create a LIVE account, you can safely ignore this email.

Thank you,
The LIVE Team
        `.trim(),

        /* ====================================================
           HTML
           ==================================================== */

        html: liveEmailLayout(`<div style="margin-bottom:20px;border-left:3px solid #0f6872;padding-left:12px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0f6872">Email verification</div><h1 style="margin:0;font-size:30px;line-height:1.15;color:#102b3f">Verify your email</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#607482">Hello ${escapeEmailHtml(cleanName)},<br><br>Welcome to LIVE. Before you sign in, confirm that this email address belongs to you.</p>${liveEmailButton(verificationUrl, 'Verify email')}<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#71838e">This verification link expires in 1 hour.</p><p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#71838e">If the button does not work, copy this link into your browser:<br><a href="${escapeEmailHtml(verificationUrl)}" style="color:#0f6872;word-break:break-all">${escapeEmailHtml(verificationUrl)}</a></p><div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe6ea;font-size:12px;line-height:1.7;color:#71838e">If you did not create a LIVE account, you can safely ignore this email.</div>`, 'Verify your LIVE email address'),
      });

      console.log(
        "VERIFICATION EMAIL SENT:",
        cleanEmail
      );

      await logIntegrationEvent({
        provider_name:
          "Gmail SMTP",
        operation:
          "send_verification_email",
        endpoint_name:
          "smtp.gmail.com",
        result:
          "success",
        duration_ms:
          Date.now() -
          emailSendStartedAt,
        attempt_number:
          1,
        correlation_id:
          correlationId,
        safe_request_metadata: {
          userId:
            user.id,
          workflow:
            "registration_email_verification",
          messageType:
            "email_verification",
        },
        safe_response_metadata: {
          accepted:
            true,
        },
      });

      await logApplicationEvent({
        level: "info",
        service_name: "auth",
        event_name:
          "VERIFICATION_EMAIL_SENT",
        message:
          "Email verification message was sent successfully.",
        correlation_id:
          correlationId,
        safe_context: {
          userId:
            user.id,
          deliveryChannel:
            "email",
        },
      });
    } catch (mailError) {
      console.error(
        "GMAIL SEND ERROR:",
        mailError
      );

      await logIntegrationEvent({
        provider_name:
          "Gmail SMTP",
        operation:
          "send_verification_email",
        endpoint_name:
          "smtp.gmail.com",
        result:
          "failure",
        duration_ms:
          Date.now() -
          emailSendStartedAt,
        attempt_number:
          1,
        correlation_id:
          correlationId,
        error_message:
          mailError instanceof Error
            ? mailError.message
            : "Verification email send failed.",
        safe_request_metadata: {
          userId:
            user.id,
          workflow:
            "registration_email_verification",
          messageType:
            "email_verification",
        },
        safe_response_metadata: {
          accepted:
            false,
        },
      });

      await logApplicationEvent({
        level: "error",
        service_name: "auth",
        event_name:
          "VERIFICATION_EMAIL_SEND_FAILED",
        message:
          "Verification email could not be sent.",
        correlation_id:
          correlationId,
        error_code:
          mailError instanceof Error
            ? mailError.name
            : "EMAIL_SEND_FAILED",
        safe_context: {
          userId:
            user.id,
        },
      });

      return errorResponse(
        "Your account was created, but the verification email could not be sent.",
        500
      );
    }

    /* ========================================================
       SUCCESS
       ======================================================== */

    await logApplicationEvent({
      level: "info",
      service_name: "auth",
      event_name:
        "REGISTRATION_SUCCESS",
      message:
        "User registration completed successfully.",
      correlation_id:
        correlationId,
      safe_context: {
        userId:
          user.id,
        role:
          user.role,
        accountStatus:
          user.status,
      },
    });

    return NextResponse.json(
      {
        ok: true,

        message:
          "Registration successful. Check your email and click the verification link.",

        email:
          cleanEmail,
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error(
      "REGISTRATION ERROR:",
      error
    );

    /*
     * Do not blindly delete here because an SMTP failure occurs
     * after the account has legitimately been created.
     */
    console.error(
      "CREATED USER BEFORE FAILURE:",
      createdUserId
    );

    await logApplicationEvent({
      level: "error",
      service_name: "auth",
      event_name:
        "REGISTRATION_UNHANDLED_ERROR",
      message:
        "Registration failed because of an unexpected server error.",
      correlation_id:
        correlationId,
      error_code:
        error instanceof Error
          ? error.name
          : "UNKNOWN_ERROR",
      safe_context: {
        userId:
          createdUserId,
      },
    });

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to register right now.",
      500
    );
  }
}

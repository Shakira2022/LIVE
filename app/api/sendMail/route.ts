import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const {
      name,
      email,
      phone,
      emergencyContactName,
      emergencyContactPhone,
      password,
    } = await request.json();

    // ------------------------------------------------------------
    // Validate required fields
    // ------------------------------------------------------------

    if (
      !name ||
      !email ||
      !phone ||
      !emergencyContactName ||
      !emergencyContactPhone ||
      !password
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "All fields are required.",
        },
        { status: 400 }
      );
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanEmergencyContactName =
      emergencyContactName.trim();
    const cleanEmergencyContactPhone =
      emergencyContactPhone.trim();

    // ------------------------------------------------------------
    // Check existing email
    // ------------------------------------------------------------

    const { data: existingEmail, error: emailError } =
      await supabase
        .from("users")
        .select("id")
        .eq("email", cleanEmail)
        .is("deleted_at", null)
        .maybeSingle();

    if (emailError) {
      console.error(
        "EMAIL CHECK ERROR:",
        emailError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to check existing account.",
        },
        { status: 500 }
      );
    }

    if (existingEmail) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "An account with this email already exists.",
        },
        { status: 409 }
      );
    }

    // ------------------------------------------------------------
    // Check existing phone
    // ------------------------------------------------------------

    const { data: existingPhone, error: phoneError } =
      await supabase
        .from("users")
        .select("id")
        .eq("phone", cleanPhone)
        .is("deleted_at", null)
        .maybeSingle();

    if (phoneError) {
      console.error(
        "PHONE CHECK ERROR:",
        phoneError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to check phone number.",
        },
        { status: 500 }
      );
    }

    if (existingPhone) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "An account with this phone number already exists.",
        },
        { status: 409 }
      );
    }

    // ------------------------------------------------------------
    // Hash password
    // ------------------------------------------------------------

    const passwordHash =
      await bcrypt.hash(password, 12);

    // ------------------------------------------------------------
    // Split name
    // ------------------------------------------------------------

    const names =
      cleanName.split(/\s+/);

    const firstName =
      names[0] || "";

    const lastName =
      names.slice(1).join(" ") || "";

    // ------------------------------------------------------------
    // Generate email verification token
    // ------------------------------------------------------------

    const verificationToken =
      uuidv4();

    const tokenExpiry =
      new Date(
        Date.now() +
          60 * 60 * 1000
      );

    // ------------------------------------------------------------
    // Create user
    // ------------------------------------------------------------

    const {
      data: user,
      error: insertError,
    } = await supabase
      .from("users")
      .insert({
        first_name: firstName,
        last_name: lastName,
        display_name: cleanName,

        email: cleanEmail,
        phone: cleanPhone,

        password_hash:
          passwordHash,

        role: "requester",

        // User must verify email first
        status: "pending",

        // Verification information
        verification_token:
          verificationToken,

        verification_token_expires_at:
          tokenExpiry,

        email_verified_at:
          null,

        created_at:
          new Date().toISOString(),

        updated_at:
          new Date().toISOString(),
      })
      .select(
        "id, email, phone, role, status, first_name, last_name, display_name"
      )
      .single();

    if (insertError) {
      console.error(
        "REGISTRATION DATABASE ERROR:",
        insertError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to create account.",
        },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------
    // Send verification email
    // ------------------------------------------------------------

    try {
      const transporter =
        nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          requireTLS: true,

          auth: {
            user:
              process.env.GMAIL_USER,

            pass:
              process.env.GMAIL_APP_PASSWORD,
          },
        });

      await transporter.sendMail({
        from: `"LIVE" <${process.env.GMAIL_USER}>`,

        to: cleanEmail,

        subject:
          "Your LIVE verification code",

        text: `
Hello ${cleanName},

Welcome to LIVE.

Your verification code is:

${verificationToken}

This code expires in 1 hour.

If you did not create this account, you can safely ignore this email.

Thank you,
The LIVE Team
        `,

        html: `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background:#f5f7f9; padding:40px;">

  <div style="max-width:620px;margin:auto;background:white;padding:40px;">

    <h1 style="color:#102b3f;">
      Verify your email
    </h1>

    <p style="color:#607482;">
      Hello ${cleanName},
    </p>

    <p style="color:#607482;">
      Welcome to LIVE. Use the verification code below
      to confirm your email address.
    </p>

    <div style="
      margin:30px 0;
      padding:25px;
      text-align:center;
      background:#f3f7f8;
      font-size:30px;
      font-weight:bold;
      letter-spacing:5px;
      color:#102b3f;
    ">
      ${verificationToken}
    </div>

    <p style="color:#607482;">
      This verification code expires in 1 hour.
    </p>

    <p style="color:#607482;">
      If you did not create this account,
      you can safely ignore this email.
    </p>

    <hr />

    <p style="font-size:12px;color:#9aa7b0;">
      LIVE — Location-aware emergency coordination
    </p>

  </div>

</body>
</html>
        `,
      });

      console.log(
        "VERIFICATION EMAIL SENT:",
        cleanEmail
      );
    } catch (emailError) {
      console.error(
        "EMAIL SENDING ERROR:",
        emailError
      );

      // Remove the account if email could not be sent
      await supabase
        .from("users")
        .delete()
        .eq("id", user.id);

      return NextResponse.json(
        {
          ok: false,
          message:
            "Account could not be created because the verification email could not be sent.",
        },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------
    // Success
    // ------------------------------------------------------------

    console.log(
      "REGISTRATION SUCCESSFUL:",
      user.id
    );

    return NextResponse.json(
      {
        ok: true,

        message:
          "Registration successful. Please check your email to verify your account.",

        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Registration error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to register right now.",
      },
      { status: 500 }
    );
  }
}
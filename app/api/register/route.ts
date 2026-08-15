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

    // ---------------------------------------------------------
    // Validate required fields
    // ---------------------------------------------------------

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

    // ---------------------------------------------------------
    // Clean input
    // ---------------------------------------------------------

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    const cleanEmergencyContactName =
      emergencyContactName.trim();

    const cleanEmergencyContactPhone =
      emergencyContactPhone.trim();

    // ---------------------------------------------------------
    // Check if email already exists
    // ---------------------------------------------------------

    const {
      data: existingEmail,
      error: emailError,
    } = await supabase
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
          message:
            "Unable to check existing account.",
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

    // ---------------------------------------------------------
    // Check if phone already exists
    // ---------------------------------------------------------

    const {
      data: existingPhone,
      error: phoneError,
    } = await supabase
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

    // ---------------------------------------------------------
    // Hash password
    // ---------------------------------------------------------

    const passwordHash =
      await bcrypt.hash(password, 12);

    // ---------------------------------------------------------
    // Split name
    // ---------------------------------------------------------

    const names =
      cleanName.split(/\s+/);

    const firstName =
      names[0] || "";

    const lastName =
      names.slice(1).join(" ") || "";

    // ---------------------------------------------------------
    // Generate email verification token
    // ---------------------------------------------------------

    const token = uuidv4();

    // ---------------------------------------------------------
    // Create user
    // ---------------------------------------------------------

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

        password_hash: passwordHash,

        role: "requester",

        status: "active",

        // Email is NOT verified yet
        email_verified_at: null,

        // Verification token
        token: token,
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

    if (insertError) {
      console.error(
        "REGISTRATION DATABASE ERROR:"
      );

      console.error(
        "Code:",
        insertError.code
      );

      console.error(
        "Message:",
        insertError.message
      );

      console.error(
        "Details:",
        insertError.details
      );

      console.error(
        "Hint:",
        insertError.hint
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

    console.log(
      "REGISTRATION SUCCESSFUL:",
      user.id
    );

    // ---------------------------------------------------------
    // Create Gmail transporter
    // ---------------------------------------------------------

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

    // ---------------------------------------------------------
    // Verify SMTP connection
    // ---------------------------------------------------------

    await transporter.verify();

    // ---------------------------------------------------------
    // Send verification email
    // ---------------------------------------------------------

    await transporter.sendMail({
      from: `"LIVE" <${process.env.GMAIL_USER}>`,

      to: cleanEmail,

      subject:
        "Your LIVE verification code",

      // Plain text version
      text: `
Hello ${cleanName},

Welcome to LIVE.

Your verification code is:

${token}

Use this code to verify your email address.

If you did not create a LIVE account, you can safely ignore this email.

Thank you,
The LIVE Team
      `,

      // HTML version
      html: `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <title>LIVE Verification</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f5f7f9;
    font-family: Arial, Helvetica, sans-serif;
    color: #102b3f;
  "
>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
      width: 100%;
      background-color: #f5f7f9;
      padding: 40px 16px;
    "
  >

    <tr>
      <td align="center">

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            max-width: 620px;
            background-color: #ffffff;
          "
        >

          <!-- HEADER -->

          <tr>
            <td
              style="
                padding: 30px 40px;
                border-bottom: 1px solid #dfe6ea;
              "
            >

              <div
                style="
                  font-size: 22px;
                  font-weight: 800;
                  color: #102b3f;
                "
              >
                LIVE
              </div>

              <div
                style="
                  margin-top: 6px;
                  font-size: 10px;
                  font-weight: 700;
                  letter-spacing: 1.4px;
                  text-transform: uppercase;
                  color: #0f6872;
                "
              >
                Secure access
              </div>

            </td>
          </tr>

          <!-- CONTENT -->

          <tr>
            <td
              style="
                padding: 48px 40px 44px;
              "
            >

              <div
                style="
                  border-left: 2px solid #0f6872;
                  padding-left: 12px;
                  margin-bottom: 22px;
                  font-size: 10px;
                  font-weight: 700;
                  letter-spacing: 1.4px;
                  text-transform: uppercase;
                  color: #0f6872;
                "
              >
                Email verification
              </div>

              <h1
                style="
                  margin: 0;
                  font-size: 34px;
                  line-height: 1.08;
                  color: #102b3f;
                "
              >
                Verify your email
              </h1>

              <p
                style="
                  margin-top: 18px;
                  font-size: 16px;
                  line-height: 1.7;
                  color: #607482;
                "
              >
                Hello ${cleanName},
                <br /><br />

                Welcome to LIVE. Use the
                verification code below to
                confirm your email address.
              </p>

              <!-- CODE -->

              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  margin-top: 36px;
                  border-top: 1px solid #d9e2e7;
                  border-bottom: 1px solid #d9e2e7;
                "
              >

                <tr>
                  <td
                    style="
                      padding: 24px 0 26px;
                    "
                  >

                    <div
                      style="
                        margin-bottom: 12px;
                        font-size: 10px;
                        font-weight: 700;
                        letter-spacing: 1.5px;
                        text-transform: uppercase;
                        color: #8b9aa4;
                      "
                    >
                      Verification code
                    </div>

                    <div
                      style="
                        font-size: 38px;
                        font-weight: 700;
                        letter-spacing: 4px;
                        word-break: break-all;
                        color: #102b3f;
                      "
                    >
                      ${token}
                    </div>

                  </td>
                </tr>

              </table>

              <p
                style="
                  margin-top: 24px;
                  font-size: 14px;
                  line-height: 1.7;
                  color: #607482;
                "
              >
                Enter this code in the LIVE
                app to verify your email address.
              </p>

              <div
                style="
                  margin-top: 30px;
                  padding-top: 20px;
                  border-top: 1px solid #dfe6ea;
                  font-size: 12px;
                  line-height: 1.7;
                  color: #71838e;
                "
              >

                <strong>
                  Security notice:
                </strong>

                If you did not request this
                verification code, you can
                safely ignore this email.

              </div>

            </td>
          </tr>

          <!-- FOOTER -->

          <tr>
            <td
              style="
                padding: 24px 40px 28px;
                border-top: 1px solid #dfe6ea;
                background-color: #f5f7f9;
              "
            >

              <div
                style="
                  font-size: 13px;
                  font-weight: 700;
                  color: #102b3f;
                "
              >
                LIVE
              </div>

              <div
                style="
                  margin-top: 5px;
                  font-size: 11px;
                  color: #71838e;
                "
              >
                Location-aware emergency coordination
              </div>

              <div
                style="
                  margin-top: 16px;
                  padding-top: 14px;
                  border-top: 1px solid #dfe6ea;
                  font-size: 10px;
                  color: #9aa7b0;
                "
              >
                This is an automated message from
                the LIVE team.
              </div>

            </td>
          </tr>

        </table>

        <div
          style="
            max-width: 620px;
            padding: 18px 10px 0;
            text-align: center;
            font-size: 10px;
            color: #9aa7b0;
          "
        >
          © ${new Date().getFullYear()}
          LIVE. All rights reserved.
        </div>

      </td>
    </tr>

  </table>

</body>
</html>
      `,
    });

    // ---------------------------------------------------------
    // Everything succeeded
    // ---------------------------------------------------------

    return NextResponse.json(
      {
        ok: true,
        message:
          "Registration successful. A verification email has been sent.",
        user,
      },
      { status: 201 }
    );

  } catch (error) {
    console.error(
      "REGISTRATION ERROR:",
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
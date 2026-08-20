import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

interface MailRequest {
  first_name: string;
  last_name: string;
  id: string;
  email: string;
}

// =====================================================
// SUPABASE SERVER CLIENT
// =====================================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// =====================================================
// SHA-256 HASH
// =====================================================

function generateSHA256(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("hex");
}

// =====================================================
// POST
// =====================================================

export async function POST(req: Request) {
  try {
    // =====================================================
    // READ REQUEST
    // =====================================================

    const body = (await req.json()) as MailRequest;

    const {
      first_name,
      last_name,
      id,
      email,
    } = body;

    // =====================================================
    // VALIDATE REQUEST
    // =====================================================

    if (!first_name || !last_name || !id || !email) {
      return NextResponse.json(
        {
          success: false,
          message:
            "First name, last name, user ID and email are required.",
        },
        { status: 400 }
      );
    }

    const fullName = `${first_name} ${last_name}`.trim();

    // =====================================================
    // CHECK GMAIL ENVIRONMENT VARIABLES
    // =====================================================

    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword =
      process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailAppPassword) {
      console.error(
        "GMAIL_USER or GMAIL_APP_PASSWORD is missing."
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Gmail email service is not configured.",
        },
        { status: 500 }
      );
    }

    // =====================================================
    // GENERATE VERIFICATION TOKEN
    // =====================================================

    const token = uuidv4();

    const createdAt = new Date();

    const tokenExpiry = new Date(
      createdAt.getTime() + 60 * 60 * 1000
    );

    // Store only the SHA-256 hash in the database
    const tokenHash = generateSHA256(token);

    console.log("VERIFICATION TOKEN CREATED");

    // =====================================================
    // SAVE TOKEN TO DATABASE
    // =====================================================

    const { error: tokenError } = await supabase
      .from("email_verification_tokens")
      .insert({
        user_id: id,
        token_hash: tokenHash,
        created_at: createdAt.toISOString(),
        expires_at: tokenExpiry.toISOString(),
      });

    if (tokenError) {
      console.error(
        "VERIFICATION TOKEN DATABASE ERROR:",
        {
          code: tokenError.code,
          message: tokenError.message,
          details: tokenError.details,
          hint: tokenError.hint,
        }
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Failed to create email verification token.",
        },
        { status: 500 }
      );
    }

    console.log(
      "VERIFICATION TOKEN SAVED FOR USER:",
      id
    );

    // =====================================================
    // CREATE GMAIL TRANSPORTER
    // =====================================================

    const transporter = nodemailer.createTransport({
      service: "gmail",

      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    // =====================================================
    // VERIFY GMAIL CONNECTION
    // =====================================================

    await transporter.verify();

    console.log(
      "GMAIL SMTP CONNECTION SUCCESSFUL"
    );

    // =====================================================
    // SEND VERIFICATION EMAIL
    // =====================================================

    await transporter.sendMail({
      from: `"LIVE" <${gmailUser}>`,

      to: email,

      subject: "Your LIVE verification code",

      // ===================================================
      // PLAIN TEXT
      // ===================================================

      text: `
Hello ${fullName},

Welcome to LIVE.

Your verification code is:

${token}

This code is required to verify your email address.

The code expires in 1 hour.

If you did not request this code, you can safely ignore this email.

Thank you,
The LIVE Team
      `,

      // ===================================================
      // HTML
      // ===================================================

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
    margin:0;
    padding:0;
    background-color:#f5f7f9;
    font-family:Arial,Helvetica,sans-serif;
    color:#102b3f;
  "
>

<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
  style="
    width:100%;
    background-color:#f5f7f9;
    padding:40px 16px;
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
    max-width:620px;
    background-color:#ffffff;
  "
>

<!-- HEADER -->

<tr>

<td
  style="
    padding:30px 40px;
    border-bottom:1px solid #dfe6ea;
  "
>

<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
>

<tr>

<td
  style="
    font-size:22px;
    font-weight:800;
    color:#102b3f;
  "
>
LIVE
</td>

<td
  align="right"
  style="
    font-size:10px;
    font-weight:700;
    letter-spacing:1.4px;
    text-transform:uppercase;
    color:#0f6872;
  "
>
Secure access
</td>

</tr>

</table>

</td>

</tr>


<!-- MAIN CONTENT -->

<tr>

<td
  style="
    padding:48px 40px 44px;
  "
>

<div
  style="
    border-left:2px solid #0f6872;
    padding-left:12px;
    margin-bottom:22px;
    font-size:10px;
    font-weight:700;
    letter-spacing:1.4px;
    text-transform:uppercase;
    color:#0f6872;
  "
>
Email verification
</div>


<h1
  style="
    margin:0;
    font-size:34px;
    line-height:1.08;
    color:#102b3f;
  "
>
Verify your email
</h1>


<p
  style="
    margin:18px 0 0;
    font-size:16px;
    line-height:1.7;
    color:#607482;
  "
>

Hello ${fullName},

<br /><br />

Welcome to LIVE. Use the verification
code below to confirm your email address
and continue.

</p>


<!-- VERIFICATION CODE -->

<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
  style="
    margin-top:36px;
    border-top:1px solid #d9e2e7;
    border-bottom:1px solid #d9e2e7;
  "
>

<tr>

<td
  style="
    padding:24px 0 26px;
  "
>

<div
  style="
    margin-bottom:12px;
    font-size:10px;
    font-weight:700;
    letter-spacing:1.5px;
    text-transform:uppercase;
    color:#8b9aa4;
  "
>
Verification code
</div>


<div
  style="
    font-size:28px;
    line-height:1.2;
    font-weight:700;
    letter-spacing:2px;
    color:#102b3f;
    word-break:break-all;
  "
>
${token}
</div>

</td>

</tr>

</table>


<p
  style="
    margin:24px 0 0;
    font-size:14px;
    line-height:1.7;
    color:#607482;
  "
>

Enter this code in the LIVE app to
verify your email address.

<br />

This code expires in 1 hour.

</p>


<!-- SECURITY NOTICE -->

<div
  style="
    margin-top:30px;
    padding-top:20px;
    border-top:1px solid #dfe6ea;
    font-size:12px;
    line-height:1.7;
    color:#71838e;
  "
>

<strong style="color:#536b78;">
Security notice:
</strong>

If you did not request this verification
code, you can safely ignore this email.

</div>

</td>

</tr>


<!-- FOOTER -->

<tr>

<td
  style="
    padding:24px 40px 28px;
    border-top:1px solid #dfe6ea;
    background-color:#f5f7f9;
  "
>

<div
  style="
    font-size:13px;
    font-weight:700;
    color:#102b3f;
  "
>
LIVE
</div>


<div
  style="
    margin-top:5px;
    font-size:11px;
    color:#71838e;
  "
>
Location-aware emergency coordination
</div>


<div
  style="
    margin-top:16px;
    padding-top:14px;
    border-top:1px solid #dfe6ea;
    font-size:10px;
    color:#9aa7b0;
  "
>
This is an automated message from
the LIVE team. Please do not reply.
</div>

</td>

</tr>

</table>


<div
  style="
    max-width:620px;
    padding:18px 10px 0;
    text-align:center;
    font-size:10px;
    color:#9aa7b0;
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

    console.log(
      "VERIFICATION EMAIL SENT TO:",
      email
    );

    // =====================================================
    // SUCCESS
    // =====================================================

    return NextResponse.json(
      {
        success: true,
        message:
          "Verification email sent successfully!",
      },
      { status: 200 }
    );

  } catch (error: any) {

    console.error(
      "SEND MAIL ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
          "Failed to send verification email.",
      },
      { status: 500 }
    );
  }
}
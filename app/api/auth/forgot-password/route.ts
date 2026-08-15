import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateResetToken } from "@/lib/reset-token";

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
        .select("id")
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

    /*
     * DEVELOPMENT MODE
     *
     * No email is sent for now.
     * The raw token is displayed in the
     * development terminal.
     */
    console.log(
      "========================================"
    );

    console.log(
      "PASSWORD RESET TOKEN:"
    );

    console.log(rawToken);

    console.log(
      "TOKEN EXPIRES:",
      expiresAt.toISOString()
    );

    console.log(
      "========================================"
    );

    return NextResponse.json({
      message:
        "Password recovery request created successfully.",
      token: rawToken,
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
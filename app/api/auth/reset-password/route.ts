import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashToken } from "@/lib/reset-token";

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json();

    // Validate input
    if (!token || !newPassword) {
      return NextResponse.json(
        {
          error:
            "Token and new password are required.",
        },
        { status: 400 }
      );
    }

    // Password requirement
    if (newPassword.length < 8) {
      return NextResponse.json(
        {
          error:
            "Password must be at least 8 characters.",
        },
        { status: 400 }
      );
    }

    // Hash the token received from the user
    const tokenHash = hashToken(token);

    // Find the reset token in the database
    const { data: resetRecord, error: tokenError } =
      await supabaseAdmin
        .from("password_recovery_tokens")
        .select(
          "id, user_id, token_hash, expires_at"
        )
        .eq("token_hash", tokenHash)
        .maybeSingle();

    if (tokenError) {
      console.error(
        "RESET TOKEN LOOKUP ERROR:",
        tokenError
      );

      return NextResponse.json(
        {
          error: "Unable to verify reset token.",
        },
        { status: 500 }
      );
    }

    // Token does not exist
    if (!resetRecord) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired reset token.",
        },
        { status: 400 }
      );
    }

    // Check whether token has expired
    if (
      new Date(resetRecord.expires_at) <
      new Date()
    ) {
      return NextResponse.json(
        {
          error:
            "This reset token has expired.",
        },
        { status: 400 }
      );
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(
      newPassword,
      12
    );

    // Update the user's password
    const { error: updateError } =
      await supabaseAdmin
        .from("users")
        .update({
          password_hash: passwordHash,
        })
        .eq("id", resetRecord.user_id);

    if (updateError) {
      console.error(
        "PASSWORD UPDATE ERROR:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Unable to update password.",
        },
        { status: 500 }
      );
    }

    // Delete the token after successful use
    // so it cannot be reused.
    const { error: deleteTokenError } =
      await supabaseAdmin
        .from("password_recovery_tokens")
        .delete()
        .eq("id", resetRecord.id);

    if (deleteTokenError) {
      console.error(
        "RESET TOKEN CLEANUP ERROR:",
        deleteTokenError
      );
    }

    return NextResponse.json(
      {
        message:
          "Password updated successfully.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "RESET PASSWORD ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while resetting the password.",
      },
      { status: 500 }
    );
  }
}
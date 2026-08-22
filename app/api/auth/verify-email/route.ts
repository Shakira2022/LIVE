import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashToken } from "@/lib/reset-token";

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    // Validate input
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        {
          error: "Verification token is required.",
        },
        { status: 400 }
      );
    }

    // Hash the token received from the user
    const tokenHash = hashToken(token);

    // Find the verification token
    const { data: verificationRecord, error: tokenError } =
      await supabaseAdmin
        .from("email_verification_tokens")
        .select(
          "id, user_id, token_hash, expires_at, used_at"
        )
        .eq("token_hash", tokenHash)
        .maybeSingle();

    if (tokenError) {
      console.error(
        "EMAIL VERIFICATION TOKEN LOOKUP ERROR:",
        tokenError
      );

      return NextResponse.json(
        {
          error: "Unable to verify email token.",
        },
        { status: 500 }
      );
    }

    // Token does not exist
    if (!verificationRecord) {
      return NextResponse.json(
        {
          error: "Invalid or expired verification token.",
        },
        { status: 400 }
      );
    }

    // Token has already been used
    if (verificationRecord.used_at) {
      return NextResponse.json(
        {
          error: "This verification token has already been used.",
        },
        { status: 400 }
      );
    }

    // Check whether token has expired
    if (
      new Date(verificationRecord.expires_at) <
      new Date()
    ) {
      return NextResponse.json(
        {
          error: "This verification token has expired.",
        },
        { status: 400 }
      );
    }

    // Mark the user's email as verified
    const { error: updateUserError } =
      await supabaseAdmin
        .from("users")
        .update({
          email_verified_at: new Date().toISOString(),
        })
        .eq("id", verificationRecord.user_id);

    if (updateUserError) {
      console.error(
        "EMAIL VERIFICATION USER UPDATE ERROR:",
        updateUserError
      );

      return NextResponse.json(
        {
          error: "Unable to verify email address.",
        },
        { status: 500 }
      );
    }

    // Mark token as used
    const { error: updateTokenError } =
      await supabaseAdmin
        .from("email_verification_tokens")
        .update({
          used_at: new Date().toISOString(),
        })
        .eq("id", verificationRecord.id);

    if (updateTokenError) {
      console.error(
        "EMAIL VERIFICATION TOKEN UPDATE ERROR:",
        updateTokenError
      );

      return NextResponse.json(
        {
          error:
            "Email was verified, but the verification token could not be updated.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: "Email verified successfully.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "EMAIL VERIFICATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while verifying your email.",
      },
      { status: 500 }
    );
  }
}
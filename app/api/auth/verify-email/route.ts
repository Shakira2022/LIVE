import {
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  createHash,
} from "crypto";

export const runtime = "nodejs";

/* ============================================================
   SUPABASE
   ============================================================ */

const supabaseUrl =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY;

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

const supabase =
  createClient(
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

function response(
  status: number,
  body: {
    ok: boolean;
    message: string;
    alreadyVerified?: boolean;
  }
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

function hashToken(
  token: string
) {
  return createHash(
    "sha256"
  )
    .update(token)
    .digest("hex");
}

/* ============================================================
   POST /api/auth/verify-email
   ============================================================ */

export async function POST(
  request: Request
) {
  try {
    /* ========================================================
       READ TOKEN
       ======================================================== */

    const body =
      await request.json();

    const token =
      String(
        body?.token ?? ""
      ).trim();

    if (!token) {
      return response(
        400,
        {
          ok: false,
          message:
            "The verification link is missing its token.",
        }
      );
    }

    /* ========================================================
       HASH TOKEN

       Raw tokens are NEVER stored in the database.
       ======================================================== */

    const tokenHash =
      hashToken(token);

    /* ========================================================
       FIND TOKEN
       ======================================================== */

    const {
      data:
        verificationRecord,

      error:
        verificationLookupError,
    } =
      await supabase
        .from(
          "email_verification_tokens"
        )
        .select(
          `
          id,
          user_id,
          token_hash,
          expires_at,
          used_at,
          created_at
          `
        )
        .eq(
          "token_hash",
          tokenHash
        )
        .maybeSingle();

    if (
      verificationLookupError
    ) {
      console.error(
        "VERIFICATION TOKEN LOOKUP ERROR:",
        verificationLookupError
      );

      return response(
        500,
        {
          ok: false,
          message:
            "Unable to verify this email right now.",
        }
      );
    }

    if (!verificationRecord) {
      return response(
        400,
        {
          ok: false,
          message:
            "This verification link is invalid.",
        }
      );
    }

    /* ========================================================
       LOAD USER
       ======================================================== */

    const {
      data: user,
      error: userError,
    } =
      await supabase
        .from("users")
        .select(
          `
          id,
          email,
          status,
          email_verified_at,
          deleted_at
          `
        )
        .eq(
          "id",
          verificationRecord.user_id
        )
        .maybeSingle();

    if (userError) {
      console.error(
        "VERIFICATION USER LOOKUP ERROR:",
        userError
      );

      return response(
        500,
        {
          ok: false,
          message:
            "Unable to verify this account.",
        }
      );
    }

    if (
      !user ||
      user.deleted_at
    ) {
      return response(
        404,
        {
          ok: false,
          message:
            "The account linked to this verification link no longer exists.",
        }
      );
    }

    /* ========================================================
       ALREADY VERIFIED

       This makes the link idempotent.

       Clicking the email twice should not show a scary error.
       ======================================================== */

    if (
      user.email_verified_at
    ) {
      return response(
        200,
        {
          ok: true,
          alreadyVerified: true,
          message:
            "Your email address is already verified. You can sign in.",
        }
      );
    }

    /* ========================================================
       USED TOKEN
       ======================================================== */

    if (
      verificationRecord.used_at
    ) {
      return response(
        400,
        {
          ok: false,
          message:
            "This verification link has already been used.",
        }
      );
    }

    /* ========================================================
       EXPIRY
       ======================================================== */

    const expiresAt =
      new Date(
        verificationRecord.expires_at
      );

    if (
      Number.isNaN(
        expiresAt.getTime()
      ) ||
      expiresAt.getTime() <
        Date.now()
    ) {
      return response(
        410,
        {
          ok: false,
          message:
            "This verification link has expired. Please request a new verification email.",
        }
      );
    }

    /* ========================================================
       ACTIVATE USER
       ======================================================== */

    const now =
      new Date().toISOString();

    const {
      error:
        userUpdateError,
    } =
      await supabase
        .from("users")
        .update({
          email_verified_at:
            now,

          status:
            "active",

          updated_at:
            now,
        })
        .eq(
          "id",
          user.id
        );

    if (userUpdateError) {
      console.error(
        "USER VERIFICATION UPDATE ERROR:",
        userUpdateError
      );

      return response(
        500,
        {
          ok: false,
          message:
            "Your verification link is valid, but the account could not be activated.",
        }
      );
    }

    /* ========================================================
       MARK TOKEN USED
       ======================================================== */

    const {
      error:
        tokenUpdateError,
    } =
      await supabase
        .from(
          "email_verification_tokens"
        )
        .update({
          used_at:
            now,
        })
        .eq(
          "id",
          verificationRecord.id
        );

    if (
      tokenUpdateError
    ) {
      console.error(
        "TOKEN USED UPDATE ERROR:",
        tokenUpdateError
      );

      /*
       * User has already been verified.
       *
       * Do not return failure simply because the token's audit
       * field failed to update.
       */
    }

    /* ========================================================
       INVALIDATE OTHER TOKENS FOR USER
       ======================================================== */

    const {
      error:
        otherTokensError,
    } =
      await supabase
        .from(
          "email_verification_tokens"
        )
        .update({
          used_at:
            now,
        })
        .eq(
          "user_id",
          user.id
        )
        .is(
          "used_at",
          null
        );

    if (
      otherTokensError
    ) {
      console.error(
        "OTHER TOKEN INVALIDATION ERROR:",
        otherTokensError
      );
    }

    /* ========================================================
       SUCCESS
       ======================================================== */

    console.log(
      "EMAIL VERIFIED:",
      user.id
    );

    return response(
      200,
      {
        ok: true,
        message:
          "Your email has been verified successfully. You can now sign in.",
      }
    );
  } catch (error) {
    console.error(
      "EMAIL VERIFICATION ERROR:",
      error
    );

    return response(
      500,
      {
        ok: false,
        message:
          "Unable to verify your email right now.",
      }
    );
  }
}
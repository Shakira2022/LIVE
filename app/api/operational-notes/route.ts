
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { verifyAccessToken } from "@/lib/auth/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    // ==================================================
    // GET AUTHORIZATION HEADER
    // ==================================================

    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // ==================================================
    // EXTRACT BEARER TOKEN
    // ==================================================

    const token = authorization.startsWith(
      "Bearer "
    )
      ? authorization.slice(7)
      : null;

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid authorization header.",
        },
        { status: 401 }
      );
    }

    // ==================================================
    // VERIFY CUSTOM JWT
    // ==================================================

    const payload =
      await verifyAccessToken(token);

    if (!payload) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid or expired access token.",
        },
        { status: 401 }
      );
    }

    // ==================================================
    // ONLY ALLOW AUTHORIZED ROLES
    // ==================================================

    if (
      payload.role !== "dispatcher" &&
      payload.role !== "admin"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You are not authorized to create operational notes.",
        },
        { status: 403 }
      );
    }

    // ==================================================
    // READ REQUEST BODY
    // ==================================================

    const body = await request.json();

    const {
      request_id,
      note,
      requester_visible = false,
    } = body;

    if (!request_id) {
      return NextResponse.json(
        {
          ok: false,
          message: "Request ID is required.",
        },
        { status: 400 }
      );
    }

    if (
      typeof note !== "string" ||
      !note.trim()
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "Operational note is required.",
        },
        { status: 400 }
      );
    }

    // ==================================================
    // VERIFY REQUEST EXISTS
    // ==================================================

    const {
      data: emergencyRequest,
      error: requestError,
    } = await supabase
      .from("emergency_requests")
      .select("id")
      .eq("id", request_id)
      .maybeSingle();

    if (requestError) {
      console.error(
        "Failed to verify emergency request:",
        requestError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to verify emergency request.",
        },
        { status: 500 }
      );
    }

    if (!emergencyRequest) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Emergency request could not be found.",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // CREATE OPERATIONAL NOTE
    // ==================================================

    const {
      data: operationalNote,
      error: noteError,
    } = await supabase
      .from("operational_notes")
      .insert({
        request_id,
        author_user_id:
          payload.userId,
        note: note.trim(),
        requester_visible:
          Boolean(requester_visible),
      })
      .select("*")
      .single();

    if (noteError) {
      console.error(
        "Failed to create operational note:",
        noteError
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Failed to save operational note.",
          error: noteError.message,
        },
        { status: 500 }
      );
    }

    console.log(
      "OPERATIONAL NOTE CREATED:",
      operationalNote
    );

    return NextResponse.json({
      ok: true,
      message:
        "Operational note saved successfully.",
      note: operationalNote,
    });
  } catch (error) {
    console.error(
      "Operational note API error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to save operational note.",
      },
      { status: 500 }
    );
  }
}
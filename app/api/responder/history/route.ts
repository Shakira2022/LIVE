import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseServer } from "@/lib/supabase-server";
import { verifyAccessToken } from "@/lib/auth/jwt";

const HISTORY_ASSIGNMENT_STATUSES = [
  "completed",
  "cancelled",
  "rejected",
] as const;

async function getAuthenticatedUser() {
  const cookieStore = await cookies();

  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return null;
  }

  const payload = await verifyAccessToken(token);

  if (!payload) {
    return null;
  }

  return payload;
}

export async function GET() {
  try {
    const authUser = await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 },
      );
    }

    if (authUser.role !== "responder") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Only responders can access assignment history.",
        },
        { status: 403 },
      );
    }

    console.log(
      "==========================================",
    );

    console.log(
      "LOADING RESPONDER ASSIGNMENT HISTORY",
    );

    console.log(
      "RESPONDER:",
      authUser.userId,
    );

    console.log(
      "==========================================",
    );

    // ==========================================================
    // LOAD ONLY FINISHED ASSIGNMENTS
    //
    // IMPORTANT:
    // Active assignments do NOT belong in history.
    //
    // Active:
    // assigned
    // acknowledged
    // en_route
    // arrived
    //
    // History:
    // completed
    // cancelled
    // rejected
    // ==========================================================

    const {
      data: assignments,
      error: assignmentError,
    } = await supabaseServer
      .from("request_assignments")
      .select("*")
      .eq(
        "responder_user_id",
        authUser.userId,
      )
      .in(
        "status",
        HISTORY_ASSIGNMENT_STATUSES,
      )
      .order("completed_at", {
        ascending: false,
        nullsFirst: false,
      })
      .order("created_at", {
        ascending: false,
      });

    if (assignmentError) {
      console.error(
        "Responder history assignment lookup failed:",
        assignmentError,
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to load assignment history.",
        },
        { status: 500 },
      );
    }

    console.log(
      "HISTORY ASSIGNMENTS:",
      assignments,
    );

    if (
      !assignments ||
      assignments.length === 0
    ) {
      return NextResponse.json(
        {
          ok: true,
          assignments: [],
        },
        { status: 200 },
      );
    }

    // ==========================================================
    // LOAD EMERGENCY REQUESTS
    // ==========================================================

    const requestIds = [
      ...new Set(
        assignments.map(
          (assignment) =>
            assignment.request_id,
        ),
      ),
    ];

    const {
      data: requests,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .select("*")
      .in("id", requestIds);

    if (requestError) {
      console.error(
        "Responder history request lookup failed:",
        requestError,
      );

      return NextResponse.json(
        {
          ok: false,
          message:
            "Unable to load emergency request history.",
        },
        { status: 500 },
      );
    }

    // ==========================================================
    // LOAD LOCATIONS
    // ==========================================================

    const {
      data: locations,
      error: locationError,
    } = await supabaseServer
      .from("request_locations")
      .select("*")
      .in("request_id", requestIds);

    if (locationError) {
      console.error(
        "Responder history location lookup failed:",
        locationError,
      );
    }

    // ==========================================================
    // COMBINE DATA
    // ==========================================================

    const history = assignments.map(
      (assignment) => {
        const request =
          requests?.find(
            (item) =>
              item.id ===
              assignment.request_id,
          );

        const location =
          locations?.find(
            (item) =>
              item.request_id ===
              assignment.request_id,
          );

        return {
          assignment,
          request: request || null,
          location: location || null,
        };
      },
    );

    console.log(
      "FINAL RESPONDER HISTORY:",
      history,
    );

    return NextResponse.json(
      {
        ok: true,
        assignments: history,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "Responder history GET error:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        message:
          "Unable to load assignment history.",
      },
      { status: 500 },
    );
  }
}
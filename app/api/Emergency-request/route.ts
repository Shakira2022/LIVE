import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const severityMap = {
  Critical: "critical",
  High: "high",
  Moderate: "moderate",
} as const;

const locationMethodMap = {
  GPS: "gps",
  Manual: "manual",
  "Map pin": "map_pin",
} as const;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      requester,
      callbackNumber,
      emergencyContact,
      category,
      severity,
      note,
      location,
    } = body;

    if (
      !requester?.id ||
      !callbackNumber ||
      !category ||
      !severity ||
      !location
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "Missing required request information.",
        },
        { status: 400 }
      );
    }

    // Generate a readable request reference
    const referenceCode = `LIVE-${Date.now()}`;

    // Used to prevent accidental duplicate submissions
    const idempotencyKey = `${requester.id}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    // 1. Create the emergency request
    const { data: emergencyRequest, error: requestError } = await supabase
      .from("emergency_requests")
      .insert({
        reference_code: referenceCode,
        requester_id: requester.id,
        category,
        severity: severityMap[severity as keyof typeof severityMap],
        note: note || null,
        callback_number: callbackNumber,
        current_status: "submitted",
        source: "responsive_web",
        idempotency_key: idempotencyKey,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (requestError) {
      console.error("Emergency request database error:", requestError);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to save the emergency request.",
        },
        { status: 500 }
      );
    }

    // 2. Save the emergency location
    const { error: locationError } = await supabase
      .from("request_locations")
      .insert({
        request_id: emergencyRequest.id,
        latitude: location.lat,
        longitude: location.lng,
        accuracy_meters: location.accuracy ?? null,
        address_text: location.address || null,
        location_method:
          locationMethodMap[
            location.method as keyof typeof locationMethodMap
          ] || "manual",
        captured_at:
          location.capturedAt || new Date().toISOString(),
      });

    if (locationError) {
      console.error("Request location database error:", locationError);

      // Remove the request if its location could not be saved
      await supabase
        .from("emergency_requests")
        .delete()
        .eq("id", emergencyRequest.id);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to save the emergency location.",
        },
        { status: 500 }
      );
    }

    // 3. Record the initial status
    const { error: historyError } = await supabase
      .from("request_status_history")
      .insert({
        request_id: emergencyRequest.id,
        previous_status: null,
        new_status: "submitted",
        changed_by_user_id: requester.id,
        actor_role: requester.role,
        changed_by_system: false,
        note: "Emergency request submitted.",
      });

    if (historyError) {
      console.error("Request status history error:", historyError);

      return NextResponse.json(
        {
          ok: false,
          message: "Request was created but status history could not be saved.",
        },
        { status: 500 }
      );
    }

    console.log("Emergency request created:", referenceCode);

    return NextResponse.json({
      ok: true,
      message: "Emergency request submitted successfully.",
      request: {
        id: emergencyRequest.id,
        referenceCode,
        status: "Submitted",
        requesterId: requester.id,
        requesterName: requester.name,
        callbackNumber,
        emergencyContact,
        category,
        severity,
        note: note || "",
        location,
        createdAt: emergencyRequest.created_at,
        updatedAt: emergencyRequest.updated_at,
        statusHistory: [
          {
            id: `history-${emergencyRequest.id}`,
            status: "Submitted",
            timestamp: emergencyRequest.created_at,
            actorName: requester.name,
            actorRole: requester.role,
            note: "Emergency request submitted.",
          },
        ],
        operationalNotes: [],
      },
    });
  } catch (error) {
    console.error("Emergency request API error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to submit emergency request.",
      },
      { status: 500 }
    );
  }
}
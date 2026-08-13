import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function normalizePhone(phone: string): string {
  return phone.trim();
}

async function findRequesterByPhone(phone: string) {
  return await supabaseServer
    .from("users")
    .select("id, phone")
    .eq("phone", normalizePhone(phone))
    .single();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    /*
     * OLD WORKING FLOW:
     *
     * /api/requests?phone=0712345678
     *
     * We keep this because the requester system
     * was originally based on the callback phone number.
     */
    const phone = url.searchParams.get("phone");

    if (!phone) {
      return NextResponse.json(
        {
          error: "Requester phone number is required.",
        },
        { status: 400 }
      );
    }

    /*
     * Find the requester using their phone number.
     */
    const {
      data: requester,
      error: requesterError,
    } = await findRequesterByPhone(phone);

    if (requesterError || !requester) {
      console.error(
        "Could not find requester:",
        requesterError
      );

      return NextResponse.json(
        {
          error:
            "Could not identify the requester account.",
        },
        { status: 404 }
      );
    }

    /*
     * Get all emergency requests belonging
     * to this requester.
     */
    const {
      data,
      error,
    } = await supabaseServer
      .from("emergency_requests")
      .select(`
        *,
        request_locations (*),
        request_status_history (*)
      `)
      .eq("requester_id", requester.id)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(
        "Failed to fetch emergency requests:",
        error
      );

      return NextResponse.json(
        {
          error:
            "Failed to fetch emergency requests.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      requests: data ?? [],
    });
  } catch (error) {
    console.error(
      "Unexpected GET error:",
      error
    );

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      category,
      severity,
      note,
      callbackNumber,
      location,
    } = body;

    /*
     * Validate the emergency request.
     */
    if (
      !category ||
      !severity ||
      !callbackNumber ||
      location?.lat === undefined ||
      location?.lng === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required emergency request information.",
        },
        { status: 400 }
      );
    }

    /*
     * Generate an idempotency key.
     */
    const idempotencyKey =
      crypto.randomUUID();

    /*
     * OLD WORKING BEHAVIOUR:
     *
     * The callback phone number identifies
     * the requester account.
     */
    const {
      data: requester,
      error: requesterError,
    } = await findRequesterByPhone(
      callbackNumber
    );

    if (
      requesterError ||
      !requester
    ) {
      console.error(
        "Could not find requester:",
        requesterError
      );

      return NextResponse.json(
        {
          error:
            "Could not identify the requester account.",
        },
        { status: 400 }
      );
    }

    /*
     * Generate a human-readable reference.
     */
    const referenceCode =
      `LIVE-${Date.now()}`;

    /*
     * Create the emergency request.
     */
    const {
      data: emergencyRequest,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .insert({
        reference_code:
          referenceCode,

        requester_id:
          requester.id,

        category,

        severity:
          severity.toLowerCase(),

        note:
          note ||
          "No additional note provided.",

        callback_number:
          callbackNumber,

        current_status:
          "submitted",

        source:
          "responsive_web",

        idempotency_key:
          idempotencyKey,
      })
      .select()
      .single();

    if (
      requestError ||
      !emergencyRequest
    ) {
      console.error(
        "Failed to create emergency request:",
        requestError
      );

      return NextResponse.json(
        {
          error:
            "Failed to create emergency request.",
        },
        { status: 500 }
      );
    }

    /*
     * Save the emergency location.
     */
    const {
      error: locationError,
    } = await supabaseServer
      .from("request_locations")
      .insert({
        request_id:
          emergencyRequest.id,

        latitude:
          location.lat,

        longitude:
          location.lng,

        accuracy_meters:
          location.accuracy ?? null,

        address_text:
          location.address ?? null,

        captured_at:
          location.capturedAt ??
          new Date().toISOString(),

        confirmed_at:
          new Date().toISOString(),

        location_method:
          "gps",
      });

    /*
     * If location saving fails,
     * remove the emergency request.
     */
    if (locationError) {
      console.error(
        "Failed to save request location:",
        locationError
      );

      await supabaseServer
        .from("emergency_requests")
        .delete()
        .eq(
          "id",
          emergencyRequest.id
        );

      return NextResponse.json(
        {
          error:
            "Emergency request was not created because its location could not be saved.",
        },
        { status: 500 }
      );
    }

    /*
     * Create the first status-history entry.
     */
    const {
      error: historyError,
    } = await supabaseServer
      .from(
        "request_status_history"
      )
      .insert({
        request_id:
          emergencyRequest.id,

        previous_status:
          null,

        new_status:
          "submitted",

        changed_by_system:
          true,

        actor_role:
          "requester",

        note:
          "Emergency request submitted.",
      });

    if (historyError) {
      console.error(
        "Failed to save request status history:",
        historyError
      );
    }

    return NextResponse.json(
      {
        message:
          "Emergency request created successfully.",

        request:
          emergencyRequest,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Unexpected POST error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Internal server error",
      },
      { status: 500 }
    );
  }
}
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
     * Find requester using their phone number.
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
     * Find the requester account.
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
          error: "Could not identify the requester account.",
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
          error: "Failed to fetch emergency requests.",
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
     * Validate emergency request.
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
     * Generate idempotency key.
     */
    const idempotencyKey = crypto.randomUUID();

    /*
     * Find requester using callback phone number.
     */
    const {
      data: requester,
      error: requesterError,
    } = await findRequesterByPhone(callbackNumber);

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
        { status: 400 }
      );
    }

    /*
     * Generate human-readable request reference.
     */
    const referenceCode = `LIVE-${Date.now()}`;

    /*
     * Create emergency request.
     */
    const {
      data: emergencyRequest,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .insert({
        reference_code: referenceCode,
        requester_id: requester.id,
        category,
        severity: severity.toLowerCase(),
        note: note || "No additional note provided.",
        callback_number: callbackNumber,
        current_status: "submitted",
        source: "responsive_web",
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (requestError || !emergencyRequest) {
      console.error(
        "Failed to create emergency request:",
        requestError
      );

      return NextResponse.json(
        {
          error: "Failed to create emergency request.",
        },
        { status: 500 }
      );
    }

    /*
     * Save emergency location.
     */
    const {
      error: locationError,
    } = await supabaseServer
      .from("request_locations")
      .insert({
        request_id: emergencyRequest.id,
        latitude: location.lat,
        longitude: location.lng,
        accuracy_meters: location.accuracy ?? null,
        address_text: location.address ?? null,
        captured_at:
          location.capturedAt ??
          new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        location_method: "gps",
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
        .eq("id", emergencyRequest.id);

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
      .from("request_status_history")
      .insert({
        request_id: emergencyRequest.id,
        previous_status: null,
        new_status: "submitted",
        changed_by_system: true,
        actor_role: "requester",
        changed_by_user_id: requester.id,
        note: "Emergency request submitted.",
      });

    if (historyError) {
      console.error(
        "Failed to save request status history:",
        historyError
      );
    }

    /*
     * ============================================================
     * CREATE NOTIFICATION FOR REQUESTER
     * ============================================================
     *
     * This creates a notification after the emergency request
     * has successfully been created.
     */
    try {
      const {
        data: notification,
        error: notificationError,
      } = await supabaseServer
        .from("notifications")
        .insert({
          recipient_user_id: requester.id,
          request_id: emergencyRequest.id,
          notification_type: "request_submitted",
          title: "Emergency Request Submitted",
          message: `Your emergency request ${referenceCode} has been submitted successfully.`,
          sensitivity: "normal",
        })
        .select()
        .single();

      if (notificationError) {
        console.error(
          "Failed to create notification:",
          notificationError
        );
      } else {
        console.log(
          "Notification created successfully:",
          notification
        );
      }
    } catch (notificationError) {
      /*
       * Notification failure should not cause the emergency
       * request itself to fail.
       */
      console.error(
        "Notification creation error:",
        notificationError
      );
    }

    /*
     * Return successful emergency request response.
     */
    return NextResponse.json(
      {
        ok: true,
        message:
          "Emergency request created successfully.",
        request: emergencyRequest,
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
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
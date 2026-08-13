import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const allowedStatuses = [
  "submitted",
  "received",
  "assigned",
  "en_route",
  "arrived",
  "closed",
  "cancelled",
  "rejected",
] as const;

type AllowedStatus = (typeof allowedStatuses)[number];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/*
 * Find an emergency request using either:
 *
 * 1. The real Supabase UUID
 * 2. The human-readable LIVE reference code
 */
async function findEmergencyRequest(
  idOrReference: string
) {
  const query = supabaseServer
    .from("emergency_requests")
    .select(`
      id,
      reference_code,
      requester_id,
      current_status,
      category,
      severity,
      note,
      callback_number,
      eta_minutes,
      is_active,
      is_cancelled,
      created_at,
      updated_at
    `);

  if (isUuid(idOrReference)) {
    return await query
      .eq("id", idOrReference)
      .single();
  }

  return await query
    .eq("reference_code", idOrReference)
    .single();
}


/* -------------------------------------------------------------------------- */
/* GET - Open / Track Request                                                 */
/* -------------------------------------------------------------------------- */

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        {
          error: "Request ID is required",
        },
        { status: 400 }
      );
    }

    /*
     * Find the request using either its UUID
     * or LIVE reference code.
     */
    const {
      data: requestData,
      error: requestError,
    } = await supabaseServer
      .from("emergency_requests")
      .select(`
        *,
        request_locations (*),
        request_status_history (*)
      `)
      .eq(
        isUuid(id)
          ? "id"
          : "reference_code",
        id
      )
      .single();

    if (
      requestError ||
      !requestData
    ) {
      console.error(
        "Failed to fetch emergency request:",
        requestError
      );

      return NextResponse.json(
        {
          error:
            "Emergency request not found",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request: requestData,
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


/* -------------------------------------------------------------------------- */
/* PATCH - Update / Cancel Request                                            */
/* -------------------------------------------------------------------------- */

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Request ID is required",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    const {
      status,
      note,
    }: {
      status?: string;
      note?: string | null;
    } = body;

    if (!status) {
      return NextResponse.json(
        {
          error:
            "Status is required",
        },
        { status: 400 }
      );
    }

    if (
      !allowedStatuses.includes(
        status as AllowedStatus
      )
    ) {
      return NextResponse.json(
        {
          error: "Invalid status",
        },
        { status: 400 }
      );
    }

    /*
     * Find the actual database request.
     *
     * This allows the frontend to send either:
     *
     * UUID:
     * 54c36827-4b93-4606-8dd1-7b7bcae23afe
     *
     * OR:
     * LIVE-1786490501079
     */
    const {
      data: existingRequest,
      error: fetchError,
    } =
      await findEmergencyRequest(id);

    if (
      fetchError ||
      !existingRequest
    ) {
      console.error(
        "Failed to find emergency request:",
        fetchError
      );

      return NextResponse.json(
        {
          error:
            "Emergency request not found",
        },
        { status: 404 }
      );
    }

    /*
     * Always use the real Supabase UUID
     * for database updates.
     */
    const requestId =
      existingRequest.id;

    const previousStatus =
      existingRequest.current_status;

    /*
     * Don't create duplicate status
     * history entries.
     */
    if (
      previousStatus === status
    ) {
      return NextResponse.json({
        message:
          "Request status is already set to this value",
        request: existingRequest,
      });
    }

    const updateData: Record<
      string,
      unknown
    > = {
      current_status: status,
    };

    /* ---------------------------------------------------------------------- */
    /* Cancellation                                                          */
    /* ---------------------------------------------------------------------- */

    if (status === "cancelled") {
      const now =
        new Date().toISOString();

      /*
       * IMPORTANT:
       *
       * We DO NOT delete the request.
       *
       * It stays in emergency_requests
       * so it appears in Request History.
       */
      updateData.is_active =
        false;

      updateData.is_cancelled =
        true;

      updateData.cancelled_at =
        now;

      updateData.cancellation_requested_at =
        now;

      updateData.cancellation_reason =
        note ||
        "Cancellation requested by requester.";
    }

    /* ---------------------------------------------------------------------- */
    /* Closed                                                                */
    /* ---------------------------------------------------------------------- */

    if (status === "closed") {
      updateData.is_active =
        false;

      updateData.closed_at =
        new Date().toISOString();
    }

    /* ---------------------------------------------------------------------- */
    /* Rejected                                                              */
    /* ---------------------------------------------------------------------- */

    if (status === "rejected") {
      updateData.is_active =
        false;

      updateData.rejected_at =
        new Date().toISOString();

      updateData.rejection_reason =
        note || null;
    }

    /*
     * Update the actual database row.
     */
    const {
      data: updatedRequest,
      error: updateError,
    } =
      await supabaseServer
        .from(
          "emergency_requests"
        )
        .update(updateData)
        .eq(
          "id",
          requestId
        )
        .select()
        .single();

    if (
      updateError ||
      !updatedRequest
    ) {
      console.error(
        "Failed to update request status:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Failed to update request status",
        },
        { status: 500 }
      );
    }

    /*
     * Save the status change
     * in request_status_history.
     */
    const {
      error: historyError,
    } =
      await supabaseServer
        .from(
          "request_status_history"
        )
        .insert({
          request_id:
            requestId,

          previous_status:
            previousStatus,

          new_status:
            status,

          changed_by_system:
            true,

          actor_role:
            "requester",

          note:
            note || null,
        });

    if (historyError) {
      console.error(
        "Failed to save status history:",
        historyError
      );

      /*
       * The request itself was updated,
       * so we return it even if history
       * saving failed.
       */
      return NextResponse.json(
        {
          error:
            "Request status was updated, but status history could not be saved",

          request:
            updatedRequest,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message:
        "Request status updated successfully",

      request:
        updatedRequest,
    });
  } catch (error) {
    console.error(
      "Unexpected PATCH error:",
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
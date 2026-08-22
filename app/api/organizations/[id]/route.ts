import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAccessToken } from "@/lib/auth/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get the organization ID from the URL
    const { id } = await params;

    // Get JWT from HTTP-only cookie
    const token = request.cookies.get("access_token")?.value;

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          message: "Unauthorized. Please log in.",
        },
        { status: 401 }
      );
    }

    // Verify JWT
    const payload = await verifyAccessToken(token);

    if (!payload) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid or expired access token.",
        },
        { status: 401 }
      );
    }

    // Only administrators can update organizations
    if (payload.role !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Forbidden. Only administrators can update organizations.",
        },
        { status: 403 }
      );
    }

    // Get request body
    const body = await request.json();

    const { status } = body;

    // Validate status
    const validStatuses = [
      "pending",
      "active",
      "paused",
      "suspended",
      "closed",
    ];

    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Invalid organization status.",
        },
        { status: 400 }
      );
    }

    // Check that organization exists
    const { data: existingOrganisation, error: findError } =
      await supabase
        .from("organisations")
        .select("id, name, status")
        .eq("id", id)
        .maybeSingle();

    if (findError) {
      console.error(
        "FIND ORGANIZATION ERROR:",
        findError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to find organization.",
        },
        { status: 500 }
      );
    }

    if (!existingOrganisation) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organization not found.",
        },
        { status: 404 }
      );
    }

    // Update organization status
    const { data: organization, error: updateError } =
      await supabase
        .from("organisations")
        .update({
          status,
        })
        .eq("id", id)
        .select()
        .single();

    if (updateError) {
      console.error(
        "UPDATE ORGANIZATION ERROR:",
        updateError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Failed to update organization.",
        },
        { status: 500 }
      );
    }

    // Record action in audit log
    const { error: auditError } = await supabase
      .from("audit_logs")
      .insert({
        actor_user_id: payload.userId,
        actor_role: payload.role,
        organisation_id: organization.id,
        action: "UPDATE_ORGANIZATION_STATUS",
        target_type: "organisation",
        target_id: organization.id,
        result: "success",
        safe_metadata: {
          previous_status: existingOrganisation.status,
          new_status: status,
        },
      });

    if (auditError) {
      console.error(
        "AUDIT LOG ERROR:",
        auditError
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Organization status updated successfully.",
        organization,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Update organization error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
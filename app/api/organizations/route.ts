import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAccessToken } from "@/lib/auth/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================
// GET ORGANIZATIONS
// ============================================
export async function GET(request: NextRequest) {
  try {
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

    // Only authorized roles can view organizations
    const allowedRoles = [
      "admin",
      "dispatcher",
      "responder",
      "auditor",
    ];

    if (!allowedRoles.includes(payload.role)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Forbidden. You do not have permission to view organizations.",
        },
        { status: 403 }
      );
    }

    // Get organizations
    const { data: organizations, error } = await supabase
      .from("organisations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET ORGANIZATIONS ERROR:", error);

      return NextResponse.json(
        {
          ok: false,
          message: "Failed to retrieve organizations.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        organizations,
        count: organizations.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get organizations error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}


// ============================================
// CREATE ORGANIZATION
// ============================================
export async function POST(request: NextRequest) {
  try {
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

    // Only administrators can create organizations
    if (payload.role !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Forbidden. Only administrators can create organizations.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const {
      name,
      organisation_type,
      registration_number,
      contact_email,
      contact_phone,
      address_line_1,
      address_line_2,
      suburb,
      city,
      province,
      postal_code,
      country_code,
      latitude,
      longitude,
      service_area_description,
      status,
    } = body;

    // ============================================
    // VALIDATION
    // ============================================

    if (!name || !organisation_type || !service_area_description) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Name, organisation type, and service area description are required.",
        },
        { status: 400 }
      );
    }

    const validOrganisationTypes = [
      "hospital",
      "emergency_response",
      "administration",
      "support",
    ];

    if (!validOrganisationTypes.includes(organisation_type)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Invalid organisation type. Use hospital, emergency_response, administration, or support.",
        },
        { status: 400 }
      );
    }

    // ============================================
    // CHECK DUPLICATE ORGANIZATION
    // ============================================

    const { data: existingOrganisation, error: duplicateError } =
      await supabase
        .from("organisations")
        .select("id")
        .ilike("name", name.trim())
        .maybeSingle();

    if (duplicateError) {
      console.error(
        "ORGANIZATION DUPLICATE CHECK ERROR:",
        duplicateError
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to validate organization name.",
        },
        { status: 500 }
      );
    }

    if (existingOrganisation) {
      return NextResponse.json(
        {
          ok: false,
          message: "An organization with this name already exists.",
        },
        { status: 409 }
      );
    }

    // ============================================
    // INSERT ORGANIZATION
    // ============================================

    const { data: organization, error } = await supabase
      .from("organisations")
      .insert({
        name: name.trim(),
        organisation_type,
        registration_number: registration_number || null,
        contact_email: contact_email || null,
        contact_phone: contact_phone || null,
        address_line_1: address_line_1 || null,
        address_line_2: address_line_2 || null,
        suburb: suburb || null,
        city: city || null,
        province: province || null,
        postal_code: postal_code || null,
        country_code: country_code || "ZA",
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        service_area_description: service_area_description.trim(),
        status: status || "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("CREATE ORGANIZATION ERROR:", error);

      return NextResponse.json(
        {
          ok: false,
          message: "Failed to create organization.",
        },
        { status: 500 }
      );
    }

    // ============================================
    // AUDIT LOG
    // ============================================

    const { error: auditError } = await supabase
      .from("audit_logs")
      .insert({
        actor_user_id: payload.userId,
        actor_role: payload.role,
        organisation_id: organization.id,
        action: "CREATE_ORGANIZATION",
        target_type: "organisation",
        target_id: organization.id,
        result: "success",
      });

    if (auditError) {
      console.error("AUDIT LOG ERROR:", auditError);
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Organization created successfully.",
        organization,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create organization error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
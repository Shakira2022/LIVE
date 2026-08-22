import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyAccessToken } from "@/lib/auth/jwt";

const ALLOWED_LOG_TYPES = [
  "audit",
  "security",
  "application",
  "integration",
] as const;

type LogType = (typeof ALLOWED_LOG_TYPES)[number];

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

export async function GET(request: Request) {
  try {
    // ============================================================
    // 1. AUTHENTICATION
    // ============================================================

    const authUser = await getAuthenticatedUser();

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // ============================================================
    // 2. AUTHORISATION
    // ============================================================

    if (
      authUser.role !== "auditor" &&
      authUser.role !== "admin"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "You do not have permission to view system logs.",
        },
        { status: 403 }
      );
    }

    // ============================================================
    // 3. LOG TYPE
    // ============================================================

    const { searchParams } = new URL(request.url);

    const type = searchParams.get("type") as LogType | null;

    if (!type || !ALLOWED_LOG_TYPES.includes(type)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "type must be audit, security, application, or integration.",
        },
        { status: 400 }
      );
    }

    // ============================================================
    // 4. FETCH LOGS
    // ============================================================

    let data = null;
    let error = null;

    if (type === "audit") {
      const result = await supabaseAdmin
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      data = result.data;
      error = result.error;
    }

    if (type === "security") {
      const result = await supabaseAdmin
        .from("security_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      data = result.data;
      error = result.error;
    }

    if (type === "application") {
      const result = await supabaseAdmin
        .from("application_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      data = result.data;
      error = result.error;
    }

    if (type === "integration") {
      const result = await supabaseAdmin
        .from("integration_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      data = result.data;
      error = result.error;
    }

    // ============================================================
    // 5. DATABASE ERROR
    // ============================================================

    if (error) {
      console.error(
        `Failed to retrieve ${type} logs:`,
        error
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to retrieve logs.",
        },
        { status: 500 }
      );
    }

    // ============================================================
    // 6. SUCCESS
    // ============================================================

    return NextResponse.json(
      {
        ok: true,
        type,
        count: data?.length ?? 0,
        logs: data ?? [],
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Auditor logs API error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to retrieve logs.",
      },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
    try {
        // 1. Get the JWT from the HTTP-only cookie
        const token = request.cookies.get("access_token")?.value;

        if (!token) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Authentication required.",
                },
                { status: 401 }
            );
        }

        // 2. Verify the JWT
        const payload = await verifyAccessToken(token);

        if (!payload) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Invalid or expired authentication token.",
                },
                { status: 401 }
            );
        }

        // 3. Only administrators may use this endpoint
        if (payload.role !== "admin") {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Administrator access required.",
                },
                { status: 403 }
            );
        }

        // 4. Retrieve users from Supabase
        const { data, error } = await supabaseAdmin
            .from("users")
            .select(`
        id,
        email,
        phone,
        role,
        status,
        first_name,
        last_name,
        display_name,
        created_at
      `)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Admin users query failed:", error);

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to retrieve users.",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            users: data ?? [],
        });
    } catch (error) {
        console.error("Admin users API error:", error);

        return NextResponse.json(
            {
                ok: false,
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}

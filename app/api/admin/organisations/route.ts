import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
    try {
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

        if (payload.role !== "admin") {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Administrator access required.",
                },
                { status: 403 }
            );
        }

        const { data, error } = await supabaseAdmin
            .from("organisations")
            .select("*")
            .order("name", { ascending: true });

        if (error) {
            console.error("Admin organisations query failed:", error);

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to retrieve organisations.",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            organisations: data ?? [],
        });
    } catch (error) {
        console.error("Admin organisations API error:", error);

        return NextResponse.json(
            {
                ok: false,
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}

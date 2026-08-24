import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAuditEvent } from "@/lib/audit-logger";

const VALID_STATUSES = [
    "active",
    "paused",
    "inactive",
];

export async function PATCH(
    request: NextRequest,
    context: {
        params: Promise<{ id: string }>;
    }
) {
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

        const { id } = await context.params;
        const body = await request.json();

        const status =
            typeof body.status === "string"
                ? body.status.toLowerCase()
                : "";

        if (!VALID_STATUSES.includes(status)) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Invalid organisation status.",
                },
                { status: 400 }
            );
        }

        const { data, error } = await supabaseAdmin
            .from("organisations")
            .update({
                status,
                updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .select("*")
            .single();

        if (error) {
            console.error(
                "Admin organisation update failed:",
                error
            );

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to update the organisation.",
                },
                { status: 500 }
            );
        }

        // Record the admin action in the audit log
        await logAuditEvent({
            actor_user_id: payload.userId,
            actor_role: payload.role,
            action: "admin_organisation_status_updated",
            target_type: "organisation",
            target_id: id,
            result: "success",
            safe_metadata: {
                newStatus: status,
            },
        });

        return NextResponse.json({
            ok: true,
            organisation: data,
        });
    } catch (error) {
        console.error(
            "Admin organisation API error:",
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

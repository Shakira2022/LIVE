import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAuditEvent } from "@/lib/audit-logger";

const VALID_ROLES = [
    "requester",
    "dispatcher",
    "responder",
    "admin",
    "auditor",
    "support",
];

const VALID_STATUSES = [
    "pending",
    "active",
    "suspended",
    "locked",
    "deactivated",
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

        if (payload.userId === id) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "You cannot modify your own role or account status.",
                },
                { status: 400 }
            );
        }


        const body = await request.json();

        const updates: {
            role?: string;
            status?: string;
            updated_at?: string;
        } = {};

        if (body.role !== undefined) {
            if (!VALID_ROLES.includes(body.role)) {
                return NextResponse.json(
                    {
                        ok: false,
                        message: "Invalid user role.",
                    },
                    { status: 400 }
                );
            }

            updates.role = body.role;
        }

        if (body.status !== undefined) {
            if (!VALID_STATUSES.includes(body.status)) {
                return NextResponse.json(
                    {
                        ok: false,
                        message: "Invalid account status.",
                    },
                    { status: 400 }
                );
            }

            updates.status = body.status;
        }

        if (!updates.role && !updates.status) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "No valid changes were supplied.",
                },
                { status: 400 }
            );
        }

        updates.updated_at = new Date().toISOString();


        const { data, error } = await supabaseAdmin
            .from("users")
            .update(updates)
            .eq("id", id)
            .is("deleted_at", null)
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
            .single();

        if (error) {
            console.error("Admin user update failed:", error);

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to update the user.",
                },
                { status: 500 }
            );
        }

        await logAuditEvent({
            actor_user_id: payload.userId,
            actor_role: payload.role,
            action: "admin_user_updated",
            target_type: "user",
            target_id: id,
            result: "success",
            safe_metadata: {
                changedRole: body.role ?? null,
                changedStatus: body.status ?? null,
            },
        });

        return NextResponse.json({
            ok: true,
            user: data,
        });
    } catch (error) {
        console.error("Admin user API error:", error);

        return NextResponse.json(
            {
                ok: false,
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}

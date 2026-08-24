import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAuditEvent } from "@/lib/audit-logger";

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
            .from("system_settings")
            .select(`
        setting_key,
        setting_value,
        description,
        is_public,
        updated_by_user_id,
        updated_at
      `)
            .order("setting_key", { ascending: true });

        if (error) {
            console.error("Admin settings query failed:", error);

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to retrieve system settings.",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            settings: data ?? [],
        });
    } catch (error) {
        console.error("Admin settings API error:", error);

        return NextResponse.json(
            {
                ok: false,
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
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

        const body = await request.json();

        const settingKey =
            typeof body.settingKey === "string"
                ? body.settingKey.trim()
                : "";

        if (!settingKey) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Setting key is required.",
                },
                { status: 400 }
            );
        }

        if (body.settingValue === undefined) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Setting value is required.",
                },
                { status: 400 }
            );
        }

        const { data, error } = await supabaseAdmin
            .from("system_settings")
            .upsert(
                {
                    setting_key: settingKey,
                    setting_value: body.settingValue,
                    description:
                        typeof body.description === "string"
                            ? body.description
                            : null,
                    is_public: Boolean(body.isPublic),
                    updated_by_user_id: payload.userId,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "setting_key",
                }
            )
            .select()
            .single();

        if (error) {
            console.error("Admin setting update failed:", error);

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to update the system setting.",
                },
                { status: 500 }
            );
        }

        await logAuditEvent({
            actor_user_id: payload.userId,
            actor_role: payload.role,
            action: "admin_system_setting_updated",
            target_type: "system_setting",
            target_id: settingKey,
            result: "success",
            safe_metadata: {
                settingKey,
            },
        });

        return NextResponse.json({
            ok: true,
            setting: data,
        });
    } catch (error) {
        console.error("Admin settings API error:", error);

        return NextResponse.json(
            {
                ok: false,
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}

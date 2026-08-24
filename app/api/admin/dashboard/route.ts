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

        const [
            usersResult,
            organisationsResult,
            activeRequestsResult,
            deniedEventsResult,
            auditResult,
        ] = await Promise.all([
            supabaseAdmin
                .from("users")
                .select("*", {
                    count: "exact",
                    head: true,
                })
                .is("deleted_at", null),

            supabaseAdmin
                .from("organisations")
                .select("*", {
                    count: "exact",
                    head: true,
                }),

            supabaseAdmin
                .from("emergency_requests")
                .select("*", {
                    count: "exact",
                    head: true,
                })
                .eq("is_active", true),

            supabaseAdmin
                .from("audit_logs")
                .select("*", {
                    count: "exact",
                    head: true,
                })
                .eq("result", "denied"),

            supabaseAdmin
                .from("audit_logs")
                .select(`
          id,
          actor_user_id,
          actor_role,
          action,
          target_type,
          target_id,
          result,
          created_at
        `)
                .order("created_at", {
                    ascending: false,
                })
                .limit(6),
        ]);

        if (
            usersResult.error ||
            organisationsResult.error ||
            activeRequestsResult.error ||
            deniedEventsResult.error ||
            auditResult.error
        ) {
            console.error("Admin dashboard query failed:", {
                users: usersResult.error,
                organisations: organisationsResult.error,
                activeRequests: activeRequestsResult.error,
                deniedEvents: deniedEventsResult.error,
                audit: auditResult.error,
            });

            return NextResponse.json(
                {
                    ok: false,
                    message: "Unable to retrieve dashboard information.",
                },
                { status: 500 }
            );
        }

        const actorIds = [
            ...new Set(
                (auditResult.data ?? [])
                    .map((log) => log.actor_user_id)
                    .filter(Boolean)
            ),
        ] as string[];

        let actorNames = new Map<string, string>();

        if (actorIds.length > 0) {
            const { data: actors, error: actorsError } =
                await supabaseAdmin
                    .from("users")
                    .select(`
            id,
            first_name,
            last_name,
            display_name,
            email
          `)
                    .in("id", actorIds);

            if (actorsError) {
                console.error(
                    "Admin dashboard actor query failed:",
                    actorsError
                );
            } else {
                actorNames = new Map(
                    (actors ?? []).map((actor) => [
                        actor.id,
                        actor.display_name ||
                        [actor.first_name, actor.last_name]
                            .filter(Boolean)
                            .join(" ") ||
                        actor.email ||
                        "Unknown user",
                    ])
                );
            }
        }

        const auditLogs = (auditResult.data ?? []).map(
            (log) => ({
                id: log.id,
                action: log.action,
                actorName:
                    (log.actor_user_id &&
                        actorNames.get(log.actor_user_id)) ||
                    log.actor_role ||
                    "System",
                target:
                    log.target_id ||
                    log.target_type ||
                    "System",
                result: log.result,
                timestamp: log.created_at,
            })
        );

        return NextResponse.json({
            ok: true,
            metrics: {
                users: usersResult.count ?? 0,
                organisations:
                    organisationsResult.count ?? 0,
                activeRequests:
                    activeRequestsResult.count ?? 0,
                deniedEvents:
                    deniedEventsResult.count ?? 0,
            },
            auditLogs,
        });
    } catch (error) {
        console.error(
            "Admin dashboard API error:",
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

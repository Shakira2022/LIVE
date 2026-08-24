import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.dashboard",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const [
      usersResult,
      organisationsResult,
      activeRequestsResult,
      deniedEventsResult,
      auditResult,
    ] = await Promise.all([
      db().from("users").select("*", { count: "exact", head: true }).is("deleted_at", null),
      db().from("organisations").select("*", { count: "exact", head: true }),
      db().from("emergency_requests").select("*", { count: "exact", head: true }).eq("is_active", true),
      db().from("audit_logs").select("*", { count: "exact", head: true }).eq("result", "denied"),
      db()
        .from("audit_logs")
        .select("id,actor_user_id,actor_role,action,target_type,target_id,result,created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    const firstError =
      usersResult.error ||
      organisationsResult.error ||
      activeRequestsResult.error ||
      deniedEventsResult.error ||
      auditResult.error;

    if (firstError) {
      throw ApiError.internal(
        "Unable to retrieve dashboard information.",
        firstError.message,
      );
    }

    const actorIds = [
      ...new Set(
        (auditResult.data ?? [])
          .map((log) => log.actor_user_id)
          .filter(Boolean),
      ),
    ] as string[];

    let actorNames = new Map<string, string>();

    if (actorIds.length > 0) {
      const { data: actors, error } = await db()
        .from("users")
        .select("id,first_name,last_name,display_name,email")
        .in("id", actorIds);

      if (!error) {
        actorNames = new Map(
          (actors ?? []).map((actor) => [
            actor.id,
            actor.display_name ||
              [actor.first_name, actor.last_name].filter(Boolean).join(" ") ||
              actor.email ||
              "Unknown user",
          ]),
        );
      }
    }

    return {
      metrics: {
        users: usersResult.count ?? 0,
        organisations: organisationsResult.count ?? 0,
        activeRequests: activeRequestsResult.count ?? 0,
        deniedEvents: deniedEventsResult.count ?? 0,
      },
      auditLogs: (auditResult.data ?? []).map((log) => ({
        id: log.id,
        action: log.action,
        actorName:
          (log.actor_user_id && actorNames.get(log.actor_user_id)) ||
          log.actor_role ||
          "System",
        target: log.target_id || log.target_type || "System",
        result: log.result,
        timestamp: log.created_at,
      })),
    };
  },
);
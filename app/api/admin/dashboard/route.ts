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
    const [usersResult, organisationsResult, activeRequestsResult, supportResult, reportsResult] = await Promise.all([
      db().from("users").select("*", { count: "exact", head: true }).is("deleted_at", null),
      db().from("organisations").select("*", { count: "exact", head: true }),
      db().from("emergency_requests").select("*", { count: "exact", head: true }).eq("is_active", true),
      db()
        .from("support_requests")
        .select("id, requester_name, subject, status, updated_at", { count: "exact" })
        .in("status", ["open", "in_progress", "waiting_on_user"])
        .order("updated_at", { ascending: false })
        .limit(5),
      db()
        .from("responder_reports")
        .select("id, responder_user_id, subject, status, created_at", { count: "exact" })
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const firstError = usersResult.error || organisationsResult.error || activeRequestsResult.error || supportResult.error || reportsResult.error;
    if (firstError) {
      throw ApiError.internal("Unable to retrieve dashboard information.", firstError.message);
    }

    const responderIds = [...new Set((reportsResult.data ?? [])
      .map((report) => report.responder_user_id)
      .filter((id): id is string => Boolean(id)))];
    let responderNames = new Map<string, string>();
    if (responderIds.length) {
      const { data: responders, error } = await db()
        .from("users")
        .select("id, first_name, last_name, display_name, email")
        .in("id", responderIds);

      if (error) throw ApiError.internal("Unable to load responder report contacts.", error.message);
      responderNames = new Map((responders ?? []).map((responder) => [
        responder.id,
        responder.display_name || [responder.first_name, responder.last_name].filter(Boolean).join(" ") || responder.email || "Responder",
      ]));
    }

    return {
      metrics: {
        users: usersResult.count ?? 0,
        organisations: organisationsResult.count ?? 0,
        activeRequests: activeRequestsResult.count ?? 0,
        openSupportRequests: supportResult.count ?? 0,
        openResponderReports: reportsResult.count ?? 0,
      },
      supportRequests: (supportResult.data ?? []).map((request) => ({
        id: request.id,
        requesterName: request.requester_name,
        subject: request.subject,
        status: request.status,
        updatedAt: request.updated_at,
      })),
      responderReports: (reportsResult.data ?? []).map((report) => ({
        id: report.id,
        responderName: report.responder_user_id ? responderNames.get(report.responder_user_id) ?? "Responder" : "Responder",
        subject: report.subject,
        createdAt: report.created_at,
      })),
    };
  },
);

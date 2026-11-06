import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.responder_reports.list",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const client = db();
    const { data: reports, error } = await client
      .from("responder_reports")
      .select("id, responder_user_id, organisation_id, reported_by_user_id, subject, details, status, resolution_action, resolution_note, resolved_by_user_id, resolved_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw ApiError.internal("Unable to load responder reports.", error.message);

    const userIds = [...new Set((reports ?? [])
      .flatMap((report) => [report.responder_user_id, report.reported_by_user_id, report.resolved_by_user_id])
      .filter((userId): userId is string => userId !== null))];
    const organisationIds = [...new Set((reports ?? []).map((report) => report.organisation_id))];
    const [{ data: users, error: usersError }, { data: organisations, error: organisationsError }] = await Promise.all([
      userIds.length
        ? client.from("users").select("id, email, phone, role, status, first_name, last_name, display_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      organisationIds.length
        ? client.from("organisations").select("id, name").in("id", organisationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersError || organisationsError) {
      throw ApiError.internal("Unable to load responder report contacts.", usersError?.message ?? organisationsError?.message);
    }

    const usersById = new Map((users ?? []).map((user) => [user.id, user]));
    const organisationsById = new Map((organisations ?? []).map((organisation) => [organisation.id, organisation.name]));
    return {
      reports: (reports ?? []).map((report) => ({
        ...report,
        responder: usersById.get(report.responder_user_id) ?? null,
        reporter: usersById.get(report.reported_by_user_id) ?? null,
        resolved_by: report.resolved_by_user_id ? usersById.get(report.resolved_by_user_id) ?? null : null,
        organisation_name: organisationsById.get(report.organisation_id) ?? "Organisation",
      })),
    };
  },
);

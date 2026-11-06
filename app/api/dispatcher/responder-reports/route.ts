import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "dispatcher.responder_reports.open",
    auth: "required",
    roles: ["dispatcher"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    if (!ctx.user.organisationId) return { responderUserIds: [] };

    const { data: reports, error } = await db()
      .from("responder_reports")
      .select("responder_user_id")
      .eq("organisation_id", ctx.user.organisationId)
      .eq("status", "open");

    if (error) throw ApiError.internal("Unable to load open responder reports.", error.message);
    return { responderUserIds: [...new Set((reports ?? []).map((report) => report.responder_user_id))] };
  },
);

const bodySchema = z.object({
  responderUserId: z.string().uuid(),
  subject: z.string().trim().min(3).max(160),
  details: z.string().trim().min(10).max(5000),
});

export const POST = createHandler(
  {
    name: "dispatcher.responder_report.create",
    auth: "required",
    roles: ["dispatcher"],
    body: bodySchema,
    rateLimit: { limit: 20, windowMs: 60_000, by: "user" },
    audit: { action: "responder_report_submitted", targetType: "responder_report" },
    successStatus: 201,
  },
  async (ctx) => {
    if (!ctx.user.organisationId) {
      throw new ApiError("BAD_REQUEST", "Your dispatcher account is not linked to an organisation.");
    }

    const client = db();
    const { data: profile, error: profileError } = await client
      .from("responder_profiles")
      .select("user_id, organisation_id")
      .eq("user_id", ctx.body.responderUserId)
      .maybeSingle();

    if (profileError) throw ApiError.internal("Unable to verify this responder.", profileError.message);
    if (!profile || profile.organisation_id !== ctx.user.organisationId) {
      throw ApiError.notFound("This responder is not in your organisation.");
    }

    const { data: responder, error: responderError } = await client
      .from("users")
      .select("id, role, status, deleted_at")
      .eq("id", ctx.body.responderUserId)
      .maybeSingle();

    if (responderError) throw ApiError.internal("Unable to verify this responder account.", responderError.message);
    if (!responder || responder.role !== "responder" || responder.status !== "active" || responder.deleted_at) {
      throw ApiError.notFound("This responder account could not be found.");
    }

    const { data: report, error } = await client
      .from("responder_reports")
      .insert({
        responder_user_id: responder.id,
        organisation_id: profile.organisation_id,
        reported_by_user_id: ctx.user.userId,
        subject: ctx.body.subject,
        details: ctx.body.details,
      })
      .select("id, responder_user_id, organisation_id, reported_by_user_id, subject, details, status, created_at")
      .single();

    if (error) throw ApiError.internal("Unable to submit this responder report.", error.message);

    ctx.audit({
      targetId: report.id,
      responderUserId: responder.id,
      organisationId: profile.organisation_id,
    });

    return { report };
  },
);

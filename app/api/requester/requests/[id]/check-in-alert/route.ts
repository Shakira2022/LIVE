import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  reason: z.enum(["missed_checkins", "unsafe_response"]),
  missedCheckIns: z.literal(4).optional(),
}).refine((body) => body.reason !== "missed_checkins" || body.missedCheckIns === 4, {
  message: "Four unanswered check-ins are required before alerting dispatch.",
});
const ACTIVE_STATUSES = ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"];

export const POST = createHandler(
  {
    name: "requester.check_in_alert",
    auth: "required",
    roles: ["requester"],
    params: paramsSchema,
    body: bodySchema,
    rateLimit: { limit: 5, windowMs: 60_000, by: "user" },
    audit: { action: "requester_voice_safety_alert", targetType: "emergency_request", logType: "application" },
  },
  async (ctx) => {
    const { data: request, error: requestError } = await db()
      .from("emergency_requests")
      .select("id, requester_id, reference_code, routed_organisation_id, current_status")
      .eq("id", ctx.params.id)
      .eq("requester_id", ctx.user.userId)
      .maybeSingle();

    if (requestError) throw ApiError.internal("Unable to verify the active emergency.", requestError.message);
    if (!request) throw ApiError.notFound();
    if (!ACTIVE_STATUSES.includes(String(request.current_status).toLowerCase())) {
      throw new ApiError("CONFLICT", "This emergency is no longer active.");
    }

    const { data: priorAlert, error: priorAlertError } = await db()
      .from("notifications")
      .select("id")
      .eq("request_id", request.id)
      .eq("notification_type", ctx.body.reason === "missed_checkins" ? "requester_unresponsive" : "requester_reports_unsafe")
      .limit(1)
      .maybeSingle();
    if (priorAlertError) throw ApiError.internal("Unable to check previous dispatcher alerts.", priorAlertError.message);
    if (priorAlert) return { notified: 0, alreadyNotified: true };

    let memberQuery = db()
      .from("organisation_members")
      .select("user_id")
      .eq("status", "active");
    if (request.routed_organisation_id) memberQuery = memberQuery.eq("organisation_id", request.routed_organisation_id);
    const { data: memberships, error: membershipError } = await memberQuery;
    if (membershipError) throw ApiError.internal("Unable to find the dispatch team.", membershipError.message);

    const memberIds = [...new Set((memberships ?? []).map((membership) => membership.user_id))];
    if (!memberIds.length) return { notified: 0, alreadyNotified: false };

    const { data: dispatchers, error: dispatchersError } = await db()
      .from("users")
      .select("id")
      .in("id", memberIds)
      .eq("role", "dispatcher")
      .eq("status", "active")
      .is("deleted_at", null);
    if (dispatchersError) throw ApiError.internal("Unable to find active dispatchers.", dispatchersError.message);

    const recipientIds = [...new Set((dispatchers ?? []).map((dispatcher) => dispatcher.id))];
    if (!recipientIds.length) return { notified: 0, alreadyNotified: false };

    const label = request.reference_code ? ` (${request.reference_code})` : "";
    const title = ctx.body.reason === "missed_checkins"
      ? `Requester missed safety check-ins${label}`
      : `Requester reports they may be unsafe${label}`;
    const message = ctx.body.reason === "missed_checkins"
      ? "The requester did not respond to four voice safety check-ins. Please review the emergency and try to contact them. A missed response does not confirm that they are unsafe."
      : "The requester said they may not be safe during a voice check-in. Please review the emergency and contact them promptly.";
    const { error: insertError } = await db().from("notifications").insert(recipientIds.map((recipientUserId) => ({
      recipient_user_id: recipientUserId,
      request_id: request.id,
      notification_type: ctx.body.reason === "missed_checkins" ? "requester_unresponsive" : "requester_reports_unsafe",
      title,
      message,
      sensitivity: "high",
    })));
    if (insertError) throw ApiError.internal("Unable to notify the dispatch team.", insertError.message);

    return { notified: recipientIds.length, alreadyNotified: false };
  },
);

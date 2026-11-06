import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  suspendResponder: z.boolean(),
  resolutionNote: z.string().trim().max(4000).optional().default(""),
});

export const PATCH = createHandler(
  {
    name: "admin.responder_reports.resolve",
    auth: "required",
    roles: ["admin"],
    params: paramsSchema,
    body: bodySchema,
    rateLimit: { limit: 40, windowMs: 60_000, by: "user" },
    audit: { action: "responder_report_resolved", targetType: "responder_report" },
  },
  async (ctx) => {
    const { data, error } = await db().rpc("resolve_responder_report", {
      p_report_id: ctx.params.id,
      p_admin_user_id: ctx.user.userId,
      p_suspend_responder: ctx.body.suspendResponder,
      p_resolution_note: ctx.body.resolutionNote || "No resolution note provided.",
    });

    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("RESPONDER_HAS_ACTIVE_ASSIGNMENT")) {
        throw new ApiError("CONFLICT", "This responder has an active emergency. Release or complete that assignment before suspending the account.");
      }
      if (message.includes("REPORT_NOT_FOUND") || message.includes("RESPONDER_NOT_FOUND")) {
        throw ApiError.notFound("This responder report or responder could not be found.");
      }
      if (message.includes("REPORT_ALREADY_RESOLVED")) {
        throw new ApiError("CONFLICT", "This report has already been resolved.");
      }
      if (message.includes("RESOLUTION_NOTE_REQUIRED")) {
        throw new ApiError("BAD_REQUEST", "Add a short resolution note before resolving this report.");
      }
      throw ApiError.internal("Unable to resolve this responder report.", error.message);
    }

    if (!data) throw ApiError.notFound("This responder report could not be found.");
    ctx.audit({
      targetId: ctx.params.id,
      responderUserId: data.responder_user_id,
      resolutionAction: data.resolution_action,
    });
    return { report: data };
  },
);

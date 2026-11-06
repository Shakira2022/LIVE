import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const createCallSchema = z.object({
  callId: z.string().trim().min(1).max(120),
  roomId: z.string().trim().min(1).max(300),
  calleeUserId: z.string().uuid().nullable().optional(),
  targetRole: z.enum(["requester", "dispatcher", "responder", "admin", "auditor"]).nullable().optional(),
  remoteName: z.string().trim().max(200).optional(),
  requestId: z.string().uuid().nullable().optional(),
});

export const POST = createHandler(
  {
    name: "calls.create",
    auth: "required",
    body: createCallSchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
    successStatus: 201,
  },
  async (ctx) => {
    const { data: call, error } = await db()
      .from("call_records")
      .insert({
        call_id: ctx.body.callId,
        room_id: ctx.body.roomId,
        caller_user_id: ctx.user.userId,
        callee_user_id: ctx.body.calleeUserId ?? null,
        target_role: ctx.body.targetRole ?? null,
        status: "ringing",
      })
      .select("id, call_id, room_id, caller_user_id, callee_user_id, status, started_at, answered_at, ended_at, duration_seconds, end_reason, created_at, updated_at")
      .single();

    if (error) throw ApiError.internal("Unable to record the call.", error.message);

    let recipientIds = ctx.body.calleeUserId && ctx.body.calleeUserId !== ctx.user.userId
      ? [ctx.body.calleeUserId]
      : [];
    if (!recipientIds.length && ctx.body.targetRole) {
      const { data: roleUsers, error: roleLookupError } = await db()
        .from("users")
        .select("id")
        .eq("role", ctx.body.targetRole)
        .neq("id", ctx.user.userId);
      if (roleLookupError) throw ApiError.internal("Unable to find call recipients.", roleLookupError.message);
      recipientIds = (roleUsers ?? []).map((row) => row.id);
    }
    if (recipientIds.length) {
      const { data: caller, error: callerLookupError } = await db()
        .from("users")
        .select("first_name, last_name, display_name, role")
        .eq("id", ctx.user.userId)
        .maybeSingle();
      if (callerLookupError) throw ApiError.internal("Unable to identify the caller.", callerLookupError.message);

      const callerName = caller?.display_name?.trim() || [caller?.first_name, caller?.last_name].filter(Boolean).join(" ") || "Unknown caller";
      const callerLabel = caller?.role === "responder" ? "Responder" : caller?.role === "dispatcher" ? "Dispatcher" : caller?.role === "requester" ? "Requester" : "LIVE user";
      const requestId = ctx.body.requestId ?? (z.string().uuid().safeParse(ctx.body.roomId).success ? ctx.body.roomId : null);
      const { error: notificationError } = await db().from("notifications").insert(
        recipientIds.map((recipientUserId) => ({
          recipient_user_id: recipientUserId,
          request_id: requestId,
          notification_type: "incoming_call",
          title: `Incoming call from ${callerName}`,
          message: `${callerLabel} ${callerName} is calling you.`,
          sensitivity: "urgent",
          call_id: ctx.body.callId,
        })),
      );
      if (notificationError) throw ApiError.internal("Unable to create the call notification.", notificationError.message);
    }

    return { call };
  },
);

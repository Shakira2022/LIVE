import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ callId: z.string().trim().min(1).max(120) });
const updateSchema = z.object({
  status: z.enum(["accepted", "declined", "missed", "ended", "failed"]),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
});

async function ensureCallAccess(callId: string, userId: string, callerUserId: string, calleeUserId: string | null) {
  if (callerUserId === userId || calleeUserId === userId) return;
  const { data: notification, error } = await db()
    .from("notifications")
    .select("id")
    .eq("call_id", callId)
    .eq("recipient_user_id", userId)
    .maybeSingle();
  if (error) throw ApiError.internal("Unable to verify call access.", error.message);
  if (!notification) throw new ApiError("NOT_FOUND", "Call record not found.");
}

export const GET = createHandler(
  {
    name: "calls.get",
    auth: "required",
    params: paramsSchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const { data: call, error } = await db()
      .from("call_records")
      .select("id, call_id, room_id, caller_user_id, callee_user_id, status, started_at, answered_at, ended_at, duration_seconds, end_reason, created_at, updated_at")
      .eq("call_id", ctx.params.callId)
      .maybeSingle();

    if (error) throw ApiError.internal("Unable to load the call details.", error.message);
    if (call) await ensureCallAccess(ctx.params.callId, ctx.user.userId, call.caller_user_id, call.callee_user_id);
    if (!call) {
      // Older notifications can outlive their call record. Keep the call-only
      // details sheet useful without exposing a notification to another user.
      const { data: notification, error: notificationError } = await db()
        .from("notifications")
        .select("call_id, notification_type, title, message, created_at")
        .eq("call_id", ctx.params.callId)
        .eq("recipient_user_id", ctx.user.userId)
        .maybeSingle();

      if (notificationError) throw ApiError.internal("Unable to load the call notification.", notificationError.message);
      if (!notification) throw new ApiError("NOT_FOUND", "Call record not found.");

      const callerMatch = notification.title?.match(/Incoming call from (.+)$/i);
      const messageMatch = notification.message?.match(/(Responder|Driver|Dispatcher|Requester|LIVE user)\s+(.+?)\s+is calling you\.?$/i);
      const callerName = callerMatch?.[1] || messageMatch?.[2] || "Unknown caller";
      const { data: recipient } = await db()
        .from("users")
        .select("id, first_name, last_name, display_name, role")
        .eq("id", ctx.user.userId)
        .maybeSingle();
      const recipientName = recipient?.display_name?.trim() || [recipient?.first_name, recipient?.last_name].filter(Boolean).join(" ") || "You";
      const callerRole = ["driver", "responder"].includes(messageMatch?.[1]?.toLowerCase() ?? "") ? "responder" : messageMatch?.[1]?.toLowerCase() ?? (recipient?.role === "requester" ? "responder" : "requester");
      const isMissed = notification.notification_type === "missed_call" || /missed call/i.test(notification.title ?? "");
      return {
        call: {
          call_id: notification.call_id,
          status: isMissed ? "missed" : "ringing",
          started_at: notification.created_at,
          answered_at: null,
          ended_at: null,
          duration_seconds: null,
          end_reason: null,
          caller: { name: callerName, role: callerRole },
          callee: { id: ctx.user.userId, name: recipientName, role: recipient?.role ?? "user" },
        },
      };
    }

    const userIds = [call.caller_user_id, call.callee_user_id].filter(Boolean);
    const { data: users, error: usersError } = await db()
      .from("users")
      .select("id, first_name, last_name, display_name, role")
      .in("id", userIds);
    if (usersError) throw ApiError.internal("Unable to load the call participants.", usersError.message);

    const participant = (id: string | null) => {
      const user = (users ?? []).find((item) => item.id === id);
      return user ? {
        id: user.id,
        name: user.display_name?.trim() || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown user",
        role: user.role,
      } : null;
    };

    return { call: { ...call, caller: participant(call.caller_user_id), callee: participant(call.callee_user_id) } };
  },
);

export const PATCH = createHandler(
  {
    name: "calls.update",
    auth: "required",
    params: paramsSchema,
    body: updateSchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const { data: existing, error: lookupError } = await db()
      .from("call_records")
      .select("id, call_id, room_id, caller_user_id, callee_user_id, status, started_at, answered_at, ended_at, duration_seconds, end_reason, created_at, updated_at")
      .eq("call_id", ctx.params.callId)
      .maybeSingle();

    if (lookupError) throw ApiError.internal("Unable to find the call record.", lookupError.message);
    if (!existing) throw new ApiError("NOT_FOUND", "Call record not found.");
    await ensureCallAccess(ctx.params.callId, ctx.user.userId, existing.caller_user_id, existing.callee_user_id);

    if (existing.ended_at) {
      // A delayed accept/end signal from the other participant must not
      // change the final call state. Allow it to fill a missing duration only.
      if (existing.duration_seconds === null && ctx.body.durationSeconds != null) {
        const { data: call, error } = await db()
          .from("call_records")
          .update({ duration_seconds: ctx.body.durationSeconds, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .is("duration_seconds", null)
          .select("id, call_id, room_id, caller_user_id, callee_user_id, status, started_at, answered_at, ended_at, duration_seconds, end_reason, created_at, updated_at")
          .maybeSingle();
        if (error) throw ApiError.internal("Unable to update the call duration.", error.message);
        return { call: call ?? existing };
      }
      return { call: existing };
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: ctx.body.status,
      updated_at: now,
      end_reason: ctx.body.reason ?? null,
    };
    if (ctx.body.status === "accepted") {
      update.answered_at = existing.answered_at ?? now;
      if (!existing.callee_user_id && existing.caller_user_id !== ctx.user.userId) {
        update.callee_user_id = ctx.user.userId;
      }
    }
    if (["declined", "missed", "ended", "failed"].includes(ctx.body.status)) {
      update.ended_at = now;
      // Preserve one shared duration across participants. Older clients may
      // omit a duration, so use the server's answered-to-ended elapsed time.
      if (existing.duration_seconds === null) {
        if (ctx.body.durationSeconds !== undefined && ctx.body.durationSeconds !== null) {
          update.duration_seconds = ctx.body.durationSeconds;
        } else if (ctx.body.status === "ended" && existing.answered_at) {
          update.duration_seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(existing.answered_at)) / 1000));
        }
      }
    }

    const { data: call, error } = await db()
      .from("call_records")
      .update(update)
      .eq("id", existing.id)
      .select("id, call_id, room_id, caller_user_id, callee_user_id, status, started_at, answered_at, ended_at, duration_seconds, end_reason, created_at, updated_at")
      .single();

    if (error) throw ApiError.internal("Unable to update the call record.", error.message);

    if (ctx.body.status === "missed") {
      let missedNotificationUpdate = db()
        .from("notifications")
        .update({
          notification_type: "missed_call",
          title: "Missed call",
          message: "You missed a LIVE call.",
          read_at: null,
        })
        .eq("call_id", ctx.params.callId);

      // A missed-call notice belongs to the person who received the call.
      // Some role-wide calls have no single callee on call_records; in that
      // case, update the recipient copies while excluding the caller.
      if (existing.callee_user_id) {
        missedNotificationUpdate = missedNotificationUpdate.eq("recipient_user_id", existing.callee_user_id);
      } else {
        missedNotificationUpdate = missedNotificationUpdate.neq("recipient_user_id", existing.caller_user_id);
      }

      const { error: notificationError } = await missedNotificationUpdate;
      if (notificationError) throw ApiError.internal("Unable to record the missed-call notification.", notificationError.message);
    }
    return { call };
  },
);

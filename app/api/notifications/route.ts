import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { reconcileResponderTerminalAssignments } from "@/lib/middleware/server/requests-service";
import { createNotification } from "@/lib/notifications/service";

export const runtime = "nodejs";

const createNotificationSchema = z.object({
  recipientUserId: z.string().uuid(),
  requestId: z.string().uuid().nullable().optional(),
  notificationType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  sensitivity: z.string().trim().max(50).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* GET /api/notifications                                                     */
/* -------------------------------------------------------------------------- */

export const GET = createHandler(
  {
    name: "notifications.list",
    auth: "required",
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Authentication comes from createHandler().
     *
     * Do NOT manually call getCurrentUser() here. The middleware pipeline
     * reads the configured access-token cookie and verifies the same JWT
     * issued by /api/auth/login.
     */
    let { data: notifications, error } = await db()
      .from("notifications")
      .select(
        "id, recipient_user_id, request_id, call_id, responder_report_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
      )
      .eq(
        "recipient_user_id",
        ctx.user.userId,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw ApiError.internal(
        "Unable to retrieve notifications.",
        error.message,
      );
    }

    // Earlier call handling incorrectly created a missed-call notice for a
    // dispatcher who had placed the call. Remove only those caller-owned
    // copies; the callee's notification remains untouched.
    if (ctx.user.role === "dispatcher") {
      const { data: outgoingMissedCalls, error: outgoingCallsError } = await db()
        .from("call_records")
        .select("call_id")
        .eq("caller_user_id", ctx.user.userId)
        .eq("status", "missed");

      if (outgoingCallsError) {
        throw ApiError.internal("Unable to verify outgoing call notifications.", outgoingCallsError.message);
      }

      const outgoingCallIds = [...new Set((outgoingMissedCalls ?? []).map((call) => call.call_id).filter(Boolean))];
      if (outgoingCallIds.length) {
        const { error: cleanupError } = await db()
          .from("notifications")
          .delete()
          .eq("recipient_user_id", ctx.user.userId)
          .eq("notification_type", "missed_call")
          .in("call_id", outgoingCallIds);

        if (cleanupError) {
          throw ApiError.internal("Unable to clear caller-side missed-call notifications.", cleanupError.message);
        }

        notifications = (notifications ?? []).filter((notification) =>
          !(notification.notification_type === "missed_call" && outgoingCallIds.includes(notification.call_id ?? "")),
        );
      }
    }

    // Repair successful requester cancellations that were committed before
    // their notification could be written. This runs during the page's
    // existing background refresh and is idempotent.
    if (ctx.user.role === "requester") {
      const { data: cancelledRequests, error: cancelledRequestsError } = await db()
        .from("emergency_requests")
        .select("id, reference_code, cancelled_at")
        .eq("requester_id", ctx.user.userId)
        .eq("current_status", "cancelled")
        .not("cancelled_at", "is", null)
        .order("cancelled_at", { ascending: false })
        .limit(100);

      if (cancelledRequestsError) {
        throw ApiError.internal("Unable to check completed cancellations.", cancelledRequestsError.message);
      }

      const notifiedRequestIds = new Set(
        (notifications ?? [])
          .filter((notification) => notification.notification_type === "request_cancelled")
          .map((notification) => notification.request_id),
      );
      const missingNotifications = (cancelledRequests ?? [])
        .filter((request) => !notifiedRequestIds.has(request.id))
        .map((request) => ({
          recipient_user_id: ctx.user.userId,
          request_id: request.id,
          notification_type: "request_cancelled",
          title: "Request cancelled",
          message: `Your request ${request.reference_code} has been successfully cancelled.`,
          sensitivity: "normal",
          created_at: request.cancelled_at,
        }));

      if (missingNotifications.length) {
        const { data: insertedNotifications, error: insertError } = await db()
          .from("notifications")
          .insert(missingNotifications)
          .select(
            "id, recipient_user_id, request_id, call_id, responder_report_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
          );

        // A concurrent refresh may have inserted the same notification.
        if (insertError && insertError.code !== "23505") {
          throw ApiError.internal("Unable to record completed cancellation notifications.", insertError.message);
        }
        notifications = [...(notifications ?? []), ...(insertedNotifications ?? [])]
          .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
      }
    } else if (ctx.user.role === "responder") {
      // Repair approved cancellation notices if the cancellation was committed
      // but its notification insert failed. Responders poll this endpoint, so
      // their pop-up and notification history can recover without a reload.
      await reconcileResponderTerminalAssignments(ctx.user.userId);

      const { data: cancelledAssignments, error: assignmentsError } = await db()
        .from("request_assignments")
        .select("request_id, cancelled_at")
        .eq("responder_user_id", ctx.user.userId)
        .eq("status", "cancelled")
        .not("cancelled_at", "is", null)
        .order("cancelled_at", { ascending: false })
        .limit(100);

      if (assignmentsError) {
        throw ApiError.internal("Unable to check responder cancellation updates.", assignmentsError.message);
      }

      const requestIds = [...new Set((cancelledAssignments ?? []).map((assignment) => assignment.request_id))];
      if (requestIds.length) {
        const [requestsResult, historyResult] = await Promise.all([
          db()
            .from("emergency_requests")
            .select("id, reference_code, cancelled_at")
            .in("id", requestIds)
            .eq("current_status", "cancelled"),
          db()
            .from("request_status_history")
            .select("request_id")
            .in("request_id", requestIds)
            .eq("new_status", "cancelled")
            .in("actor_role", ["dispatcher", "admin"]),
        ]);

        if (requestsResult.error) {
          throw ApiError.internal("Unable to verify responder cancellation updates.", requestsResult.error.message);
        }
        if (historyResult.error) {
          throw ApiError.internal("Unable to verify cancellation approval history.", historyResult.error.message);
        }

        const approvedRequestIds = new Set((historyResult.data ?? []).map((entry) => entry.request_id));
        const cancelledRequests = new Map((requestsResult.data ?? [])
          .filter((request) => approvedRequestIds.has(request.id))
          .map((request) => [request.id, request]));
        const notifiedRequestIds = new Set(
          (notifications ?? [])
            .filter((notification) => notification.notification_type === "request_cancelled_by_dispatcher")
            .map((notification) => notification.request_id),
        );
        const assignmentByRequest = new Map((cancelledAssignments ?? []).map((assignment) => [assignment.request_id, assignment]));
        const missingNotifications = [...cancelledRequests.values()]
          .filter((request) => !notifiedRequestIds.has(request.id))
          .map((request) => ({
            recipient_user_id: ctx.user.userId,
            request_id: request.id,
            notification_type: "request_cancelled_by_dispatcher",
            title: "Request cancelled by dispatch",
            message: `The requester's cancellation for ${request.reference_code} was approved by dispatch.`,
            sensitivity: "urgent",
            created_at: request.cancelled_at ?? assignmentByRequest.get(request.id)?.cancelled_at ?? new Date().toISOString(),
          }));

        if (missingNotifications.length) {
          const { data: insertedNotifications, error: insertError } = await db()
            .from("notifications")
            .insert(missingNotifications)
            .select(
              "id, recipient_user_id, request_id, call_id, responder_report_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
            );

          if (insertError && insertError.code !== "23505") {
            throw ApiError.internal("Unable to record responder cancellation notifications.", insertError.message);
          }
          notifications = [...(notifications ?? []), ...(insertedNotifications ?? [])]
            .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
        }
      }
    }

    return {
      notifications: notifications ?? [],
    };
  },
);

/* -------------------------------------------------------------------------- */
/* POST /api/notifications                                                    */
/* -------------------------------------------------------------------------- */

export const POST = createHandler(
  {
    name: "notifications.create",
    auth: "required",
    body: createNotificationSchema,
    rateLimit: {
      limit: 60,
      windowMs: 60_000,
      by: "user",
    },
    successStatus: 201,
  },
  async (ctx) => {
    /*
     * Preserve the existing createNotification service.
     *
     * This route only changes authentication/validation so it uses the same
     * middleware session as the rest of the application.
     */
    const notification =
      await createNotification({
        recipientUserId:
          ctx.body.recipientUserId,

        requestId:
          ctx.body.requestId ??
          undefined,

        notificationType:
          ctx.body.notificationType,

        title:
          ctx.body.title,

        message:
          ctx.body.message,

        sensitivity:
          ctx.body.sensitivity,

        expiresAt:
          ctx.body.expiresAt ??
          undefined,
      });

    return {
      notification,
    };
  },
);

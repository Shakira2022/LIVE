import { supabaseServer } from "@/lib/supabase-server";

export interface CreateNotificationInput {
  recipientUserId: string;
  requestId?: string | null;
  notificationType: string;
  title: string;
  message: string;
  sensitivity?: string;
  expiresAt?: string | null;
}

export async function createNotification(
  input: CreateNotificationInput,
) {
  const { data, error } = await supabaseServer
    .from("notifications")
    .insert({
      recipient_user_id: input.recipientUserId,
      request_id: input.requestId ?? null,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message,
      sensitivity: input.sensitivity ?? "normal",
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("Notification creation error:", error);
    throw new Error("Unable to create notification.");
  }

  return data;
}

export async function notifyNewRequest(
  recipientUserId: string,
  requestId: string,
) {
  return createNotification({
    recipientUserId,
    requestId,
    notificationType: "new_request",
    title: "New Emergency Request",
    message: "A new emergency request has been received.",
    sensitivity: "normal",
  });
}

export async function notifyAssignment(
  recipientUserId: string,
  requestId: string,
) {
  return createNotification({
    recipientUserId,
    requestId,
    notificationType: "assignment",
    title: "New Mission Assignment",
    message: "You have been assigned to an emergency request.",
    sensitivity: "normal",
  });
}

export async function notifyStatusChange(
  recipientUserId: string,
  requestId: string,
  status: string,
) {
  return createNotification({
    recipientUserId,
    requestId,
    notificationType: "status_change",
    title: "Request Status Updated",
    message: `The emergency request status has changed to ${status}.`,
    sensitivity: "normal",
  });
}

export async function notifyRequestCancellationCompleted(input: {
  recipientUserId: string;
  requestId: string;
  reference: string;
  message?: string;
}) {
  const { data: existing, error: lookupError } = await supabaseServer
    .from("notifications")
    .select("id")
    .eq("recipient_user_id", input.recipientUserId)
    .eq("request_id", input.requestId)
    .eq("notification_type", "request_cancelled")
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error("Unable to check the cancellation completion notification.");
  if (existing) return existing;

  return createNotification({
    recipientUserId: input.recipientUserId,
    requestId: input.requestId,
    notificationType: "request_cancelled",
    title: "Request cancelled",
    message: input.message ?? `Your request ${input.reference} has been successfully cancelled.`,
    sensitivity: "normal",
  });
}

export async function notifyRespondersOfCancellationApproval(input: {
  responderUserIds: string[];
  requestId: string;
  reference: string;
}) {
  const recipientIds = [...new Set(input.responderUserIds.filter(Boolean))];
  if (!recipientIds.length) return 0;

  const { data: existing, error: lookupError } = await supabaseServer
    .from("notifications")
    .select("recipient_user_id")
    .eq("request_id", input.requestId)
    .eq("notification_type", "request_cancelled_by_dispatcher")
    .in("recipient_user_id", recipientIds);
  if (lookupError) throw new Error("Unable to check responder cancellation notifications.");

  const alreadyNotified = new Set((existing ?? []).map((row) => row.recipient_user_id));
  const missingRecipientIds = recipientIds.filter((recipientId) => !alreadyNotified.has(recipientId));
  if (!missingRecipientIds.length) return 0;

  const { error: insertError } = await supabaseServer
    .from("notifications")
    .insert(missingRecipientIds.map((recipientUserId) => ({
      recipient_user_id: recipientUserId,
      request_id: input.requestId,
      notification_type: "request_cancelled_by_dispatcher",
      title: "Request cancelled by dispatch",
      message: `The requester's cancellation for ${input.reference} was approved by dispatch.`,
      sensitivity: "urgent",
    })));
  if (insertError) throw new Error("Unable to notify responders about the approved cancellation.");

  return missingRecipientIds.length;
}

export async function notifyOrganisationDispatchers(input: {
  organisationId: string | null | undefined;
  requestId: string;
  notificationType: string;
  title: string;
  message: string;
  sensitivity?: string;
}) {
  if (!input.organisationId) return 0;

  const { data: memberships, error: membershipError } = await supabaseServer
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", input.organisationId)
    .eq("status", "active");
  if (membershipError) throw new Error("Unable to find active dispatchers for this organisation.");

  const memberIds = [...new Set((memberships ?? []).map((membership) => membership.user_id).filter(Boolean))];
  if (!memberIds.length) return 0;

  const { data: dispatchers, error: dispatcherError } = await supabaseServer
    .from("users")
    .select("id")
    .in("id", memberIds)
    .eq("role", "dispatcher")
    .eq("status", "active")
    .is("deleted_at", null);
  if (dispatcherError) throw new Error("Unable to find active dispatchers for this organisation.");

  const recipientIds = [...new Set((dispatchers ?? []).map((dispatcher) => dispatcher.id))];
  if (!recipientIds.length) return 0;

  const { data: existingNotifications, error: existingNotificationError } = await supabaseServer
    .from("notifications")
    .select("recipient_user_id")
    .eq("request_id", input.requestId)
    .eq("notification_type", input.notificationType)
    .in("recipient_user_id", recipientIds);
  if (existingNotificationError) throw new Error("Unable to check existing dispatcher notifications.");
  const alreadyNotified = new Set((existingNotifications ?? []).map((notification) => notification.recipient_user_id));
  const missingRecipientIds = recipientIds.filter((recipientId) => !alreadyNotified.has(recipientId));
  if (!missingRecipientIds.length) return 0;

  const { error: notificationError } = await supabaseServer
    .from("notifications")
    .insert(missingRecipientIds.map((recipientUserId) => ({
      recipient_user_id: recipientUserId,
      request_id: input.requestId,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message,
      sensitivity: input.sensitivity ?? "normal",
    })));
  if (notificationError) throw new Error("Unable to create dispatcher notifications.");

  return missingRecipientIds.length;
}

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
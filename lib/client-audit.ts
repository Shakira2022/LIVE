export interface ClientAuditEvent {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  result: "success" | "denied" | "warning" | "failure";
  safeMetadata?: Record<string, unknown>;
}

export async function recordAuditEvent(
  event: ClientAuditEvent,
) {
  try {
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actor_user_id: null,
        actor_role: event.actorRole ?? null,
        action: event.action,
        target_type: event.targetType,
        target_id: event.targetId ?? null,
        result: event.result,
        safe_metadata: {
          ...(event.safeMetadata ?? {}),
          ...(event.actorUserId
          ? { mock_actor_user_id: event.actorUserId }
          : {}),
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      console.error(
        "Audit API request failed:",
        response.status,
        errorBody,
      );
    }
  } catch (error) {
    console.error(
      "Unable to send audit event:",
      error,
    );
  }
}
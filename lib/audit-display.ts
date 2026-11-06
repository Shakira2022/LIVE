const ACTION_LABELS: Record<string, string> = {
  "emergency_request.responder_status_updated": "Emergency request responder status updated",
  "responder.availability_updated": "Responder availability updated",
  admin_user_updated: "Administrator user updated",
  ASSIGN_REQUEST: "Emergency request assigned",
  USER_UPDATED: "User details updated",
  USER_CREATED: "User account created",
  USER_DELETED: "User account deleted",
};

const SECURITY_EVENT_LABELS: Record<string, string> = {
  "auth.login.success": "Successful sign-in",
  "auth.login.failed": "Failed sign-in attempt",
  "auth.token.refreshed": "Session refreshed",
  "auth.logout": "User signed out",
};

function humanizeEventName(value: string) {
  const words = value
    .replace(/[._]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatAuditAction(action: string) {
  return ACTION_LABELS[action] ?? humanizeEventName(action);
}

export function formatSecurityEvent(eventType: string) {
  return SECURITY_EVENT_LABELS[eventType] ?? humanizeEventName(eventType);
}

export function formatApplicationEvent(eventName: string) {
  return humanizeEventName(eventName);
}

export function formatIntegrationOperation(operation: string) {
  return humanizeEventName(operation);
}

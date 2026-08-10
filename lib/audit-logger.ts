import { supabaseServer } from "./supabase-server";

export type AuditResult =
  | "success"
  | "denied"
  | "warning"
  | "failure";

export interface AuditLogData {
  actor_user_id?: string | null;
  actor_role?: string | null;
  organisation_id?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  request_id?: string | null;
  correlation_id?: string | null;
  result: AuditResult;
  ip_address?: string | null;
  user_agent?: string | null;
  safe_metadata?: Record<string, unknown>;
}

export interface AuditLogResult {
  success: boolean;
  error?: string;
}

export async function logAuditEvent(
  data: AuditLogData
): Promise<AuditLogResult> {
  const { error } = await supabaseServer
    .from("audit_logs")
    .insert({
      actor_user_id: data.actor_user_id ?? null,
      actor_role: data.actor_role ?? null,
      organisation_id: data.organisation_id ?? null,
      action: data.action,
      target_type: data.target_type,
      target_id: data.target_id ?? null,
      request_id: data.request_id ?? null,
      correlation_id: data.correlation_id ?? undefined,
      result: data.result,
      ip_address: data.ip_address ?? null,
      user_agent: data.user_agent ?? null,
      safe_metadata: data.safe_metadata ?? {},
    });

  if (error) {
    console.error("Failed to create audit log:", error);

    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
  };
}
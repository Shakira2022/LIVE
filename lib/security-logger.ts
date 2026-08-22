import { supabaseServer } from "./supabase-server";

export type SecurityResult =
  | "success"
  | "denied"
  | "warning"
  | "failure";

export interface SecurityLogData {
  user_id?: string | null;
  event_type: string;
  result: SecurityResult;
  correlation_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  safe_metadata?: Record<string, unknown>;
}

export async function logSecurityEvent(
  data: SecurityLogData,
) {
  const { error } = await supabaseServer
    .from("security_logs")
    .insert({
      user_id: data.user_id ?? null,
      event_type: data.event_type,
      result: data.result,
      correlation_id: data.correlation_id ?? undefined,
      ip_address: data.ip_address ?? null,
      user_agent: data.user_agent ?? null,
      safe_metadata: data.safe_metadata ?? {},
    });

  if (error) {
    console.error("Failed to create security log:", error);

    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
  };
}


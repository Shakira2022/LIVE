import { supabaseAdmin } from "./supabase-admin";

export type ApplicationLogLevel =
  | "debug"
  | "info"
  | "warning"
  | "error"
  | "critical";

export interface ApplicationLogData {
  level: ApplicationLogLevel;
  service_name: string;
  event_name: string;
  message: string;

  request_id?: string | null;
  correlation_id?: string | null;
  error_code?: string | null;

  safe_context?: Record<string, unknown>;
}

export async function logApplicationEvent(
  data: ApplicationLogData,
) {
  const { error } = await supabaseAdmin
    .from("application_logs")
    .insert({
      level: data.level,
      service_name: data.service_name,
      event_name: data.event_name,
      message: data.message,

      request_id: data.request_id ?? null,
      correlation_id: data.correlation_id ?? null,
      error_code: data.error_code ?? null,

      safe_context: data.safe_context ?? {},
    });

  if (error) {
    console.error(
      "Failed to create application log:",
      error,
    );

    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
  };
}
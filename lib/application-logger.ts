import { randomUUID } from "crypto";

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

  /*
   * Optional emergency-request relationship.
   *
   * Only populate this when the application log is associated
   * with an emergency request.
   */
  request_id?: string | null;

  /*
   * Correlation ID groups related application events into the
   * same workflow.
   *
   * For request-scoped operations, callers should pass ctx.requestId.
   *
   * If a caller does not provide one, this helper generates one
   * instead of storing NULL.
   */
  correlation_id?: string | null;

  error_code?: string | null;

  /*
   * Safe, non-secret context that helps an auditor understand
   * what entity/workflow the event relates to.
   *
   * Examples:
   *
   * {
   *   userId: "...",
   *   role: "requester"
   * }
   *
   * Never store passwords, verification tokens, JWTs, API keys
   * or other secrets in this object.
   */
  safe_context?: Record<
    string,
    unknown
  >;
}

export interface ApplicationLogResult {
  success: boolean;

  correlationId: string;

  error?: string;
}

export async function logApplicationEvent(
  data: ApplicationLogData,
): Promise<ApplicationLogResult> {
  /*
   * Prefer the correlation ID supplied by the request middleware.
   *
   * This means events such as:
   *
   * REGISTRATION_STARTED
   * VERIFICATION_TOKEN_CREATED
   * VERIFICATION_EMAIL_SENT
   * REGISTRATION_SUCCESS
   *
   * can all share ctx.requestId and therefore appear as one
   * traceable workflow.
   *
   * The fallback UUID prevents unrelated application events from
   * being written with correlation_id = NULL.
   */
  const correlationId =
    data.correlation_id?.trim() ||
    randomUUID();

  const safeContext = {
    ...(data.safe_context ?? {}),
  };

  const {
    error,
  } = await supabaseAdmin
    .from(
      "application_logs",
    )
    .insert({
      level:
        data.level,

      service_name:
        data.service_name,

      event_name:
        data.event_name,

      message:
        data.message,

      request_id:
        data.request_id ??
        null,

      correlation_id:
        correlationId,

      error_code:
        data.error_code ??
        null,

      safe_context:
        safeContext,
    });

  if (error) {
    console.error(
      "Failed to create application log:",
      error,
    );

    return {
      success: false,

      correlationId,

      error:
        error.message,
    };
  }

  return {
    success: true,

    correlationId,
  };
}
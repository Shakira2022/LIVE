import { randomUUID } from "crypto";

import { supabaseAdmin } from "./supabase-admin";

export type IntegrationResult =
  | "success"
  | "denied"
  | "warning"
  | "failure";

export interface IntegrationLogData {
  integration_id?: string | null;
  organisation_id?: string | null;
  request_id?: string | null;

  provider_name: string;
  operation: string;
  endpoint_name?: string | null;

  http_status?: number | null;
  result: IntegrationResult;

  duration_ms?: number | null;
  attempt_number?: number;

  error_message?: string | null;

  /*
   * Related calls should explicitly reuse the request/workflow correlation ID.
   * A fallback UUID is generated only when the caller does not have one.
   */
  correlation_id?: string | null;

  safe_request_metadata?: Record<string, unknown>;
  safe_response_metadata?: Record<string, unknown>;
}

export interface IntegrationLogResult {
  success: boolean;
  correlationId: string;
  error?: string;
}

export async function logIntegrationEvent(
  data: IntegrationLogData,
): Promise<IntegrationLogResult> {
  const correlationId =
    data.correlation_id?.trim() ||
    randomUUID();

  const { error } =
    await supabaseAdmin
      .from("integration_logs")
      .insert({
        integration_id:
          data.integration_id ??
          null,

        organisation_id:
          data.organisation_id ??
          null,

        request_id:
          data.request_id ??
          null,

        provider_name:
          data.provider_name,

        operation:
          data.operation,

        endpoint_name:
          data.endpoint_name ??
          null,

        http_status:
          data.http_status ??
          null,

        result:
          data.result,

        duration_ms:
          data.duration_ms ??
          null,

        attempt_number:
          data.attempt_number ??
          1,

        error_message:
          data.error_message ??
          null,

        correlation_id:
          correlationId,

        safe_request_metadata:
          data.safe_request_metadata ??
          {},

        safe_response_metadata:
          data.safe_response_metadata ??
          {},
      });

  if (error) {
    console.error(
      "Failed to create integration log:",
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
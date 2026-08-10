import { NextResponse } from "next/server";
import {
  logAuditEvent,
  type AuditLogData,
} from "@/lib/audit-logger";

const VALID_RESULTS = [
  "success",
  "denied",
  "warning",
  "failure",
] as const;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AuditLogData>;

    if (!body.action || typeof body.action !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "action is required",
        },
        { status: 400 },
      );
    }

    if (
      !body.target_type ||
      typeof body.target_type !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "target_type is required",
        },
        { status: 400 },
      );
    }

    if (
      !body.result ||
      !VALID_RESULTS.includes(
        body.result as (typeof VALID_RESULTS)[number],
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "result must be success, denied, warning, or failure",
        },
        { status: 400 },
      );
    }

    const auditData: AuditLogData = {
      actor_user_id: body.actor_user_id ?? null,
      actor_role: body.actor_role ?? null,
      organisation_id: body.organisation_id ?? null,
      action: body.action,
      target_type: body.target_type,
      target_id: body.target_id ?? null,
      request_id: body.request_id ?? null,
      correlation_id: body.correlation_id ?? null,
      result: body.result as AuditLogData["result"],
      ip_address: body.ip_address ?? null,
      user_agent: body.user_agent ?? null,
      safe_metadata: body.safe_metadata ?? {},
    };

    const result = await logAuditEvent(auditData);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? "Unable to create audit log",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Audit event recorded successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Audit API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Invalid audit request",
      },
      { status: 400 },
    );
  }
}
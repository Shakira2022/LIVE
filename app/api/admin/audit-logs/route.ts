import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const logQuerySchema = z.object({
  type: z.enum([
    "audit",
    "security",
    "application",
    "integration",
  ]),
});

const LOG_TABLES = {
  audit: "audit_logs",
  security: "security_logs",
  application: "application_logs",
  integration: "integration_logs",
} as const;


function toIsoTimestamp(
  value: unknown,
): unknown {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return value;
  }

  const direct = new Date(value);

  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  /*
   * PostgreSQL timestamptz example:
   * 2026-08-19 21:05:11.193614+00
   */
  const match = value
    .trim()
    .match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}(?::?\d{2})?|Z)?$/,
    );

  if (!match) {
    return value;
  }

  const [, datePart, timePart, fractionRaw, zoneRaw] =
    match;

  const fraction = fractionRaw
    ? `.${fractionRaw.slice(0, 3).padEnd(3, "0")}`
    : "";

  let zone = zoneRaw || "Z";

  if (/^[+-]\d{2}$/.test(zone)) {
    zone = `${zone}:00`;
  } else if (/^[+-]\d{4}$/.test(zone)) {
    zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  }

  const parsed = new Date(
    `${datePart}T${timePart}${fraction}${zone}`,
  );

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString();
}

function normalizeLogTimestamps(
  rows: unknown[],
) {
  return rows.map((row) => {
    if (
      !row ||
      typeof row !== "object"
    ) {
      return row;
    }

    const record =
      row as Record<string, unknown>;

    return {
      ...record,
      created_at:
        toIsoTimestamp(
          record.created_at,
        ),
      updated_at:
        toIsoTimestamp(
          record.updated_at,
        ),
    };
  });
}

export const GET = createHandler(
  {
    name: "auditor.logs",
    auth: "required",
    roles: ["auditor", "admin"],
    query: logQuerySchema,
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Authentication and role checks are handled by createHandler().
     * Do not manually read an "access_token" cookie here.
     *
     * createHandler reads the configured COOKIE_ACCESS value and verifies
     * the same JWT that /api/auth/login issued.
     */
    const table =
      LOG_TABLES[ctx.query.type];

    const {
      data,
      error,
    } = await db()
      .from(table)
      .select("*")
      .order("created_at", {
        ascending: false,
      })
      .limit(100);

    if (error) {
      throw ApiError.internal(
        "Unable to retrieve logs.",
        error.message,
      );
    }

    const normalizedLogs =
      normalizeLogTimestamps(
        data ?? [],
      );

    return {
      type: ctx.query.type,
      count:
        normalizedLogs.length,
      logs:
        normalizedLogs,
    };
  },
);
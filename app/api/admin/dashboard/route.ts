import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

/*
 * A request counts as completed when it has been closed and was not
 * cancelled or rejected. closed_at is also the time it was completed.
 */
const COMPLETED_AT_COLUMN = "closed_at";

/*
 * Column that stores how critical a request is (for example
 * critical, high, medium, low). Change it to match the table.
 */
const SEVERITY_COLUMN = "severity";

const TREND_DAYS = 90;
const TREND_HOURS = 24;
const PAGE_SIZE = 1000;
const HOUR_MS = 60 * 60 * 1000;
const STUCK_AFTER_MINUTES = 10;

type Bucket = { submitted: number; completed: number };
type TimestampRow = Record<string, string | null>;

const toDayKey = (value: string) => new Date(value).toISOString().slice(0, 10);
const toHourKey = (value: string) => new Date(value).toISOString().slice(0, 13);

/*
 * Supabase returns at most 1000 rows per query, so timestamps are read
 * page by page. This keeps the trend counts correct as the data grows.
 */
async function fetchAllRows(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>,
) {
  const rows: TimestampRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }

    const page = (data ?? []) as TimestampRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return { data: rows, error: null };
}

export const GET = createHandler(
  {
    name: "admin.dashboard",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

    const startDateUtc = new Date(todayUtc);
    startDateUtc.setUTCDate(startDateUtc.getUTCDate() - (TREND_DAYS - 1));

    const endDateUtc = new Date(todayUtc);
    endDateUtc.setUTCDate(endDateUtc.getUTCDate() + 1);

    // Fetch one extra day so a rolling 90 day window is never cut short.
    const fetchStartUtc = new Date(startDateUtc);
    fetchStartUtc.setUTCDate(fetchStartUtc.getUTCDate() - 1);

    const currentHourUtc = new Date();
    currentHourUtc.setUTCMinutes(0, 0, 0);

    const startHourUtc = new Date(
      currentHourUtc.getTime() - (TREND_HOURS - 1) * HOUR_MS,
    );

    const queryStartedAt = Date.now();

    const [
      usersResult,
      organisationsResult,
      submittedTotalResult,
      completedTotalResult,
      submittedRowsResult,
      completedRowsResult,
      severityRowsResult,
      stuckResult,
      deniedEventsResult,
      successEventsResult,
      totalEventsResult,
      auditResult,
    ] = await Promise.all([
      // All users since the app started (soft-deleted accounts excluded).
      db()
        .from("users")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      db()
        .from("organisations")
        .select("*", { count: "exact", head: true }),
      // All requests ever submitted.
      db()
        .from("emergency_requests")
        .select("*", { count: "exact", head: true }),
      // All requests ever completed.
      db()
        .from("emergency_requests")
        .select("*", { count: "exact", head: true })
        .not(COMPLETED_AT_COLUMN, "is", null)
        .is("cancelled_at", null)
        .is("rejected_at", null),
      fetchAllRows((from, to) =>
        db()
          .from("emergency_requests")
          .select("submitted_at")
          .gte("submitted_at", fetchStartUtc.toISOString())
          .lt("submitted_at", endDateUtc.toISOString())
          .order("submitted_at", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        db()
          .from("emergency_requests")
          .select(COMPLETED_AT_COLUMN)
          .not(COMPLETED_AT_COLUMN, "is", null)
          .is("cancelled_at", null)
          .is("rejected_at", null)
          .gte(COMPLETED_AT_COLUMN, fetchStartUtc.toISOString())
          .lt(COMPLETED_AT_COLUMN, endDateUtc.toISOString())
          .order(COMPLETED_AT_COLUMN, { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        db()
          .from("emergency_requests")
          .select(`submitted_at,${SEVERITY_COLUMN}`)
          .gte("submitted_at", fetchStartUtc.toISOString())
          .lt("submitted_at", endDateUtc.toISOString())
          .order("submitted_at", { ascending: true })
          .range(from, to),
      ),
      // Active requests nobody has been assigned to after STUCK_AFTER_MINUTES.
      db()
        .from("emergency_requests")
        .select("id,severity,submitted_at", { count: "exact" })
        .eq("is_active", true)
        .is("assigned_at", null)
        .is("cancelled_at", null)
        .is("rejected_at", null)
        .lt(
          "submitted_at",
          new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString(),
        )
        .order("submitted_at", { ascending: true })
        .limit(8),
      db()
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("result", "denied"),
      db()
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("result", "success"),
      db()
        .from("audit_logs")
        .select("*", { count: "exact", head: true }),
      db()
        .from("audit_logs")
        .select(
          "id,actor_user_id,actor_role,action,target_type,target_id,result,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    /*
     * The completed stats depend on COMPLETED_AT_COLUMN
     * matching the real table. If they are wrong, log it and show zeros for
     * completed instead of failing the whole dashboard.
     */
    if (completedTotalResult.error) {
      console.error(
        "Dashboard completed total failed:",
        completedTotalResult.error.message,
      );
    }

    if (completedRowsResult.error) {
      console.error(
        "Dashboard completed trend failed:",
        completedRowsResult.error.message,
      );
    }

    if (severityRowsResult.error) {
      console.error(
        "Dashboard severity breakdown failed:",
        severityRowsResult.error.message,
      );
    }

    if (stuckResult.error) {
      console.error("Dashboard stuck requests failed:", stuckResult.error.message);
    }

    const firstError =
      usersResult.error ||
      organisationsResult.error ||
      submittedTotalResult.error ||
      submittedRowsResult.error ||
      deniedEventsResult.error ||
      successEventsResult.error ||
      totalEventsResult.error ||
      auditResult.error;

    if (firstError) {
      console.error("Dashboard query failed:", firstError.message);

      throw ApiError.internal(
        "Unable to retrieve dashboard information.",
        firstError.message,
      );
    }

    const dayBuckets = new Map<string, Bucket>();
    const hourBuckets = new Map<string, Bucket>();

    for (let index = 0; index < TREND_DAYS; index += 1) {
      const date = new Date(startDateUtc);
      date.setUTCDate(date.getUTCDate() + index);
      dayBuckets.set(date.toISOString().slice(0, 10), {
        submitted: 0,
        completed: 0,
      });
    }

    for (let index = 0; index < TREND_HOURS; index += 1) {
      const hour = new Date(startHourUtc.getTime() + index * HOUR_MS);
      hourBuckets.set(hour.toISOString().slice(0, 13), {
        submitted: 0,
        completed: 0,
      });
    }

    const tally = (
      rows: TimestampRow[],
      column: string,
      field: keyof Bucket,
    ) => {
      for (const row of rows) {
        const value = row[column];

        if (!value) {
          continue;
        }

        const day = dayBuckets.get(toDayKey(value));
        if (day) {
          day[field] += 1;
        }

        const hour = hourBuckets.get(toHourKey(value));
        if (hour) {
          hour[field] += 1;
        }
      }
    };

    tally(submittedRowsResult.data ?? [], "submitted_at", "submitted");
    tally(completedRowsResult.data ?? [], COMPLETED_AT_COLUMN, "completed");

    const requestTrends = [...dayBuckets].map(([date, counts]) => ({
      date,
      ...counts,
    }));

    // hour is an ISO timestamp (UTC) so the browser can show local time.
    const hourlyTrends = [...hourBuckets].map(([hour, counts]) => ({
      hour: `${hour}:00:00.000Z`,
      ...counts,
    }));

    const SEVERITY_WINDOWS: Record<string, number> = {
      "24h": 24 * HOUR_MS,
      "7d": 7 * 24 * HOUR_MS,
      "30d": 30 * 24 * HOUR_MS,
      "90d": 90 * 24 * HOUR_MS,
    };

    const nowMs = Date.now();
    const severityBreakdown: Record<
      string,
      { severity: string; count: number }[]
    > = {};

    for (const [key, windowMs] of Object.entries(SEVERITY_WINDOWS)) {
      const counts = new Map<string, number>();

      for (const row of severityRowsResult.data ?? []) {
        const submittedAt = row.submitted_at;

        if (!submittedAt) {
          continue;
        }

        if (nowMs - new Date(submittedAt).getTime() > windowMs) {
          continue;
        }

        const severity = String(
          row[SEVERITY_COLUMN] ?? "unknown",
        ).toLowerCase();

        counts.set(severity, (counts.get(severity) ?? 0) + 1);
      }

      severityBreakdown[key] = [...counts].map(([severity, count]) => ({
        severity,
        count,
      }));
    }

    /*
     * Rolling totals for each period, for example "past 7 days" means the
     * last 7 x 24 hours from now. Longer periods always include shorter ones.
     */
    const periodTotals: Record<string, Bucket> = {};

    const countWithin = (
      rows: TimestampRow[],
      column: string,
      windowMs: number,
    ) =>
      rows.filter((row) => {
        const value = row[column];

        return !!value && nowMs - new Date(value).getTime() <= windowMs;
      }).length;

    for (const [key, windowMs] of Object.entries(SEVERITY_WINDOWS)) {
      periodTotals[key] = {
        submitted: countWithin(
          submittedRowsResult.data ?? [],
          "submitted_at",
          windowMs,
        ),
        completed: countWithin(
          completedRowsResult.data ?? [],
          COMPLETED_AT_COLUMN,
          windowMs,
        ),
      };
    }

    // Requests per critical level for every day and hour, for the line chart.
    const severityByDay = new Map<string, Record<string, number>>(
      [...dayBuckets.keys()].map((key) => [key, {}]),
    );
    const severityByHour = new Map<string, Record<string, number>>(
      [...hourBuckets.keys()].map((key) => [key, {}]),
    );

    for (const row of severityRowsResult.data ?? []) {
      const at = row.submitted_at;

      if (!at) {
        continue;
      }

      const severity = String(row[SEVERITY_COLUMN] ?? "unknown").toLowerCase();
      const day = severityByDay.get(toDayKey(at));
      const hour = severityByHour.get(toHourKey(at));

      if (day) {
        day[severity] = (day[severity] ?? 0) + 1;
      }

      if (hour) {
        hour[severity] = (hour[severity] ?? 0) + 1;
      }
    }

    const severityTrends = {
      daily: [...severityByDay].map(([date, counts]) => ({ date, counts })),
      hourly: [...severityByHour].map(([hour, counts]) => ({
        hour: `${hour}:00:00.000Z`,
        counts,
      })),
    };

    /*
     * Locations are read in a separate query so that, if the latitude or
     * longitude columns are named differently, only the location is missing
     * and the rest of the panel still works.
     */
    const stuckIds = ((stuckResult.data ?? []) as { id: string }[]).map(
      (item) => item.id,
    );

    const locationById = new Map<
      string,
      { latitude: number | null; longitude: number | null }
    >();

    if (stuckIds.length > 0) {
      const { data: locations, error: locationError } = await db()
        .from("emergency_requests")
        .select("id,latitude,longitude")
        .in("id", stuckIds);

      if (locationError) {
        console.error(
          "Dashboard request locations failed:",
          locationError.message,
        );
      } else {
        for (const row of (locations ?? []) as {
          id: string;
          latitude: number | string | null;
          longitude: number | string | null;
        }[]) {
          locationById.set(row.id, {
            latitude: row.latitude == null ? null : Number(row.latitude),
            longitude: row.longitude == null ? null : Number(row.longitude),
          });
        }
      }
    }

    const stuckRequests = {
      total: stuckResult.count ?? 0,
      items: (
        (stuckResult.data ?? []) as {
          id: string;
          severity: string;
          submitted_at: string;
        }[]
      ).map((item) => ({
        id: item.id,
        severity: String(item.severity).toLowerCase(),
        submittedAt: item.submitted_at,
        latitude: locationById.get(item.id)?.latitude ?? null,
        longitude: locationById.get(item.id)?.longitude ?? null,
        waitingMinutes: Math.round(
          (nowMs - new Date(item.submitted_at).getTime()) / 60_000,
        ),
      })),
    };

    const submittedRows = submittedRowsResult.data ?? [];
    const lastRequestAt = submittedRows[submittedRows.length - 1]?.submitted_at;
    const lastAuditAt = auditResult.data?.[0]?.created_at;
    const dbMs = Date.now() - queryStartedAt;

    const ago = (iso?: string | null) => {
      if (!iso) {
        return "none yet";
      }

      const minutes = Math.round((nowMs - new Date(iso).getTime()) / 60_000);

      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;

      return `${Math.round(minutes / 1440)} days ago`;
    };

    const health = [
      {
        title: "Database",
        ok: dbMs < 2000,
        detail: `Dashboard queries completed in ${dbMs} ms`,
      },
      {
        title: "Authentication",
        ok: true,
        detail: "Session valid and admin role verified",
      },
      {
        title: "Request intake",
        ok: Boolean(lastRequestAt),
        detail: `Last request received ${ago(lastRequestAt)}`,
      },
      {
        title: "Audit logging",
        ok: Boolean(lastAuditAt),
        detail: `Last event recorded ${ago(lastAuditAt)}`,
      },
    ];

    const actorIds = [
      ...new Set(
        (auditResult.data ?? [])
          .map((log) => log.actor_user_id)
          .filter(Boolean),
      ),
    ] as string[];

    let actorNames = new Map<string, string>();

    if (actorIds.length > 0) {
      const { data: actors, error } = await db()
        .from("users")
        .select("id,first_name,last_name,display_name,email")
        .in("id", actorIds);

      if (!error) {
        actorNames = new Map(
          (actors ?? []).map((actor) => [
            actor.id,
            actor.display_name ||
              [actor.first_name, actor.last_name].filter(Boolean).join(" ") ||
              actor.email ||
              "Unknown user",
          ]),
        );
      }
    }

    return {
      metrics: {
        users: usersResult.count ?? 0,
        organisations: organisationsResult.count ?? 0,
        deniedEvents: deniedEventsResult.count ?? 0,
        successEvents: successEventsResult.count ?? 0,
        totalEvents: totalEventsResult.count ?? 0,
        submittedRequests: submittedTotalResult.count ?? 0,
        completedRequests: completedTotalResult.count ?? 0,
      },
      requestTrends,
      hourlyTrends,
      severityBreakdown,
      severityTrends,
      periodTotals,
      stuckRequests,
      health,
      generatedAt: new Date().toISOString(),
      auditLogs: (auditResult.data ?? []).map((log) => ({
        id: log.id,
        action: log.action,
        actorName:
          (log.actor_user_id && actorNames.get(log.actor_user_id)) ||
          log.actor_role ||
          "System",
        target: log.target_id || log.target_type || "System",
        result: log.result,
        timestamp: log.created_at,
      })),
    };
  },
);
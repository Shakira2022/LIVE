import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

/*
 * Adjust these two to match the emergency_requests table.
 * COMPLETED_STATUS is the value in the status column that means "done".
 * COMPLETED_AT_COLUMN is the timestamp set when a request is completed
 * (use "updated_at" if there is no dedicated column).
 */
const COMPLETED_STATUS = "completed";
const COMPLETED_AT_COLUMN = "completed_at";

const TREND_DAYS = 90;
const TREND_HOURS = 24;
const PAGE_SIZE = 1000;
const HOUR_MS = 60 * 60 * 1000;

type Bucket = { submitted: number; completed: number };
type TimestampRow = Record<string, string | null>;

const toDayKey = (value: string) => new Date(value).toISOString().slice(0, 10);
const toHourKey = (value: string) => new Date(value).toISOString().slice(0, 13);

/*
 * Supabase returns at most 1000 rows per query, so timestamps are read
 * page by page. This keeps the trend counts correct as the data grows.
 */
async function fetchAllTimestamps(
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

    const currentHourUtc = new Date();
    currentHourUtc.setUTCMinutes(0, 0, 0);

    const startHourUtc = new Date(
      currentHourUtc.getTime() - (TREND_HOURS - 1) * HOUR_MS,
    );

    const [
      usersResult,
      organisationsResult,
      activeRequestsResult,
      submittedTotalResult,
      completedTotalResult,
      submittedRowsResult,
      completedRowsResult,
      deniedEventsResult,
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
      db()
        .from("emergency_requests")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true),
      // All requests ever submitted.
      db()
        .from("emergency_requests")
        .select("*", { count: "exact", head: true }),
      // All requests ever completed.
      db()
        .from("emergency_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", COMPLETED_STATUS),
      fetchAllTimestamps((from, to) =>
        db()
          .from("emergency_requests")
          .select("submitted_at")
          .gte("submitted_at", startDateUtc.toISOString())
          .lt("submitted_at", endDateUtc.toISOString())
          .order("submitted_at", { ascending: true })
          .range(from, to),
      ),
      fetchAllTimestamps((from, to) =>
        db()
          .from("emergency_requests")
          .select(COMPLETED_AT_COLUMN)
          .eq("status", COMPLETED_STATUS)
          .gte(COMPLETED_AT_COLUMN, startDateUtc.toISOString())
          .lt(COMPLETED_AT_COLUMN, endDateUtc.toISOString())
          .order(COMPLETED_AT_COLUMN, { ascending: true })
          .range(from, to),
      ),
      db()
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("result", "denied"),
      db()
        .from("audit_logs")
        .select(
          "id,actor_user_id,actor_role,action,target_type,target_id,result,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    /*
     * The completed stats depend on COMPLETED_STATUS and COMPLETED_AT_COLUMN
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

    const firstError =
      usersResult.error ||
      organisationsResult.error ||
      activeRequestsResult.error ||
      submittedTotalResult.error ||
      submittedRowsResult.error ||
      deniedEventsResult.error ||
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
        activeRequests: activeRequestsResult.count ?? 0,
        deniedEvents: deniedEventsResult.count ?? 0,
        submittedRequests: submittedTotalResult.count ?? 0,
        completedRequests: completedTotalResult.count ?? 0,
      },
      requestTrends,
      hourlyTrends,
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
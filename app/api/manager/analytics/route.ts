import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  province: z.string().optional(),
  area: z.string().optional(),
  organisationId: z.string().optional(),
  granularity: z.enum(["day", "month", "year"]).optional(),
  include: z.enum(["overview", "security"]).optional(),
});

function dateBucket(value: string, granularity: "day" | "month" | "year") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  if (granularity === "year") return String(date.getUTCFullYear());
  if (granularity === "month") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return date.toISOString().slice(0, 10);
}

function dateRangeBuckets(from: string | undefined, to: string | undefined, granularity: "day" | "month" | "year") {
  if (!from || !to) return [];
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const cursor = new Date(start);
  if (granularity === "year") cursor.setUTCMonth(0, 1);
  if (granularity === "month") cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  if (granularity === "year") last.setUTCMonth(0, 1);
  if (granularity === "month") last.setUTCDate(1);
  last.setUTCHours(0, 0, 0, 0);
  const buckets: string[] = [];
  while (cursor <= last && buckets.length < 5000) {
    buckets.push(dateBucket(cursor.toISOString(), granularity));
    if (granularity === "year") cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
    else if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export const GET = createHandler(
  {
    name: "manager.analytics",
    auth: "required",
    roles: ["manager", "admin"],
    query: querySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const client = db();
    const { data: organisations, error: organisationsError } = await client
      .from("organisations")
      .select("id,name,province,city,suburb,status")
      .eq("status", "active")
      .order("name", { ascending: true });
    if (organisationsError) throw ApiError.internal("Unable to load manager filters.", organisationsError.message);

    const allOrganisations = organisations ?? [];
    const normalized = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
    const selectedOrganisations = allOrganisations.filter((organisation) =>
      (!ctx.query.organisationId || organisation.id === ctx.query.organisationId)
      && (!ctx.query.province || normalized(organisation.province) === normalized(ctx.query.province))
      && (!ctx.query.area || [organisation.city, organisation.suburb].some((value) => normalized(value) === normalized(ctx.query.area))),
    );
    const organisationIds = selectedOrganisations.map((organisation) => organisation.id);
    const organisationById = new Map(allOrganisations.map((organisation) => [organisation.id, organisation]));

    const empty = organisationIds.length === 0 && (ctx.query.province || ctx.query.area || ctx.query.organisationId);
    let requestRows: any[] = [];
    if (!empty) {
      let requestQuery = client
        .from("emergency_requests")
        .select("id,reference_code,category,severity,current_status,submitted_at,created_at,assigned_at,routed_organisation_id")
        .order("submitted_at", { ascending: false })
        .limit(10_000);
      if (ctx.query.from) requestQuery = requestQuery.gte("submitted_at", ctx.query.from);
      if (ctx.query.to) requestQuery = requestQuery.lte("submitted_at", ctx.query.to);
      if (ctx.query.province || ctx.query.area || ctx.query.organisationId) {
        requestQuery = organisationIds.length
          ? requestQuery.in("routed_organisation_id", organisationIds)
          : requestQuery.eq("routed_organisation_id", "00000000-0000-0000-0000-000000000000");
      }
      const { data, error } = await requestQuery;
      if (error) throw ApiError.internal("Unable to load incident analytics.", error.message);
      requestRows = data ?? [];
    }

    const requestIds = requestRows.map((request) => request.id);
    const [{ data: locations, error: locationsError }, { data: history, error: historyError }] = await Promise.all([
      requestIds.length
        ? client.from("request_locations").select("request_id,latitude,longitude,address_text,captured_at").in("request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? client.from("request_status_history").select("request_id,new_status,created_at").in("request_id", requestIds).order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (locationsError || historyError) throw ApiError.internal("Unable to load incident details.", locationsError?.message ?? historyError?.message);

    const locationByRequest = new Map<string, any>();
    for (const location of locations ?? []) if (!locationByRequest.has(location.request_id)) locationByRequest.set(location.request_id, location);
    const responseAtByRequest = new Map<string, number>();
    for (const entry of history ?? []) {
      if (["assigned", "acknowledged", "en_route", "arrived"].includes(String(entry.new_status).toLowerCase()) && !responseAtByRequest.has(entry.request_id)) {
        responseAtByRequest.set(entry.request_id, new Date(entry.created_at).getTime());
      }
    }

    const granularity = ctx.query.granularity ?? "day";
    const trendCounts = new Map<string, number>();
    const responseCounts = new Map<string, { total: number; count: number }>();
    const severityByPeriod = new Map<string, { critical: number; high: number; moderate: number; other: number }>();
    const statuses = new Map<string, number>();
    const categories = new Map<string, number>();
    const severities = new Map<string, number>();
    const provinces = new Map<string, number>();
    const areas = new Map<string, number>();
    const durations: number[] = [];
    const incidents = requestRows.map((request) => {
      const organisation = organisationById.get(request.routed_organisation_id);
      const submittedAt = new Date(request.submitted_at ?? request.created_at).getTime();
      const bucket = dateBucket(request.submitted_at ?? request.created_at, granularity);
      increment(trendCounts, bucket);
      increment(statuses, String(request.current_status ?? "unknown"));
      increment(categories, String(request.category ?? "unknown"));
      const severity = String(request.severity ?? "unknown").toLowerCase();
      increment(severities, severity);
      const periodSeverity = severityByPeriod.get(bucket) ?? { critical: 0, high: 0, moderate: 0, other: 0 };
      if (severity === "critical" || severity === "high" || severity === "moderate") periodSeverity[severity] += 1;
      else periodSeverity.other += 1;
      severityByPeriod.set(bucket, periodSeverity);
      increment(provinces, organisation?.province || "Unspecified");
      increment(areas, organisation?.suburb || organisation?.city || "Unspecified");
      const responseTime = responseAtByRequest.get(request.id) ?? (request.assigned_at ? new Date(request.assigned_at).getTime() : NaN);
      let responseMinutes: number | null = null;
      if (Number.isFinite(submittedAt) && Number.isFinite(responseTime) && responseTime >= submittedAt) {
        responseMinutes = Math.round((responseTime - submittedAt) / 60_000);
        durations.push(responseMinutes);
        const group = responseCounts.get(bucket) ?? { total: 0, count: 0 };
        group.total += responseMinutes;
        group.count += 1;
        responseCounts.set(bucket, group);
      }
      const location = locationByRequest.get(request.id);
      return {
        id: request.id,
        reference: request.reference_code,
        category: request.category,
        severity: request.severity,
        status: request.current_status,
        submittedAt: request.submitted_at ?? request.created_at,
        responseMinutes,
        organisation: organisation?.name ?? "Unrouted",
        organisationId: request.routed_organisation_id,
        province: organisation?.province ?? "Unspecified",
        area: organisation?.suburb || organisation?.city || "Unspecified",
        address: location?.address_text ?? null,
      };
    });

    const openCount = incidents.filter((incident) => !["closed", "cancelled", "rejected"].includes(String(incident.status).toLowerCase())).length;
    const criticalCount = incidents.filter((incident) => String(incident.severity).toLowerCase() === "critical").length;
    const averageResponseMinutes = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
    const toSeries = (map: Map<string, number>) => [...map.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([label, value]) => ({ label, value }));
    const trendLabels = new Set([...trendCounts.keys(), ...dateRangeBuckets(ctx.query.from, ctx.query.to, granularity)]);
    const trend = [...trendLabels].sort((first, second) => first.localeCompare(second)).map((label) => ({
      label,
      value: trendCounts.get(label) ?? 0,
      responseMinutes: responseCounts.has(label) ? Math.round(responseCounts.get(label)!.total / responseCounts.get(label)!.count) : null,
      ...(severityByPeriod.get(label) ?? { critical: 0, high: 0, moderate: 0, other: 0 }),
    }));

    let securityLogs: any[] = [];
    if (ctx.query.include === "security") {
      let logQuery = client.from("security_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (ctx.query.from) logQuery = logQuery.gte("created_at", ctx.query.from);
      if (ctx.query.to) logQuery = logQuery.lte("created_at", ctx.query.to);
      const { data, error } = await logQuery;
      if (error) throw ApiError.internal("Unable to load security events.", error.message);
      securityLogs = data ?? [];
      const actorIds = [...new Set(securityLogs.map((log) => log.actor_user_id ?? log.user_id).filter(Boolean))] as string[];
      if (actorIds.length) {
        const [{ data: memberships, error: membershipsError }, { data: profiles, error: profilesError }] = await Promise.all([
          client.from("organisation_members").select("user_id,organisation_id").eq("status", "active").in("user_id", actorIds),
          client.from("responder_profiles").select("user_id,organisation_id").in("user_id", actorIds),
        ]);
        if (membershipsError || profilesError) {
          throw ApiError.internal("Unable to apply security event organisation filters.", membershipsError?.message ?? profilesError?.message);
        }
        const actorOrganisations = new Map<string, Set<string>>();
        for (const row of [...(memberships ?? []), ...(profiles ?? [])]) {
          const organisationsForActor = actorOrganisations.get(row.user_id) ?? new Set<string>();
          organisationsForActor.add(row.organisation_id);
          actorOrganisations.set(row.user_id, organisationsForActor);
        }
        securityLogs = securityLogs.filter((log) => {
          const metadata = log.safe_metadata ?? log.metadata ?? {};
          const actorId = log.actor_user_id ?? log.user_id;
          const explicitOrganisationId = log.organisation_id ?? metadata.organisation_id;
          const candidateIds = explicitOrganisationId
            ? [explicitOrganisationId]
            : [...(actorOrganisations.get(actorId) ?? [])];
          if (!candidateIds.length) return !ctx.query.organisationId && !ctx.query.province && !ctx.query.area;
          const matchesFilters = candidateIds.some((organisationId) => {
            const organisation = organisationById.get(organisationId);
            return (!ctx.query.organisationId || organisationId === ctx.query.organisationId)
              && (!ctx.query.province || normalized(organisation?.province) === normalized(ctx.query.province))
              && (!ctx.query.area || [organisation?.city, organisation?.suburb].some((value) => normalized(value) === normalized(ctx.query.area)));
          });
          if (!matchesFilters) return false;
          return true;
        });
      } else if (ctx.query.organisationId || ctx.query.province || ctx.query.area) {
        securityLogs = [];
      }
    }

    return {
      summary: {
        totalIncidents: incidents.length,
        openIncidents: openCount,
        criticalIncidents: criticalCount,
        averageResponseMinutes,
        respondingOrganisations: new Set(incidents.map((incident) => incident.organisationId).filter(Boolean)).size,
      },
      trend,
      statuses: toSeries(statuses),
      categories: toSeries(categories),
      severities: toSeries(severities),
      provinces: toSeries(provinces),
      areas: toSeries(areas),
      incidents,
      securityLogs,
      filters: {
        provinces: [...new Set(allOrganisations.map((organisation) => organisation.province).filter(Boolean))].sort(),
        areas: [...new Set(allOrganisations.flatMap((organisation) => [organisation.city, organisation.suburb]).filter(Boolean))].sort(),
        organisations: allOrganisations.map(({ id, name, province, city, suburb }) => ({ id, name, province, city, suburb })),
      },
    };
  },
);

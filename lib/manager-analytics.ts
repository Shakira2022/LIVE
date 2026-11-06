export type ManagerGranularity = "day" | "month" | "year";
export type ManagerAnalyticsSection = "overview" | "security";

export type ManagerFilters = {
  from: string;
  to: string;
  granularity: ManagerGranularity;
  province: string;
  area: string;
  organisationId: string;
};

export function managerDefaultDates(now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: localDate(from), to: localDate(to) };
}

export function managerAnalyticsParams(filters: ManagerFilters, section: ManagerAnalyticsSection) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  params.set("granularity", filters.granularity);
  params.set("include", section);
  if (filters.province) params.set("province", filters.province);
  if (filters.area) params.set("area", filters.area);
  if (filters.organisationId) params.set("organisationId", filters.organisationId);
  return params;
}

export function managerAnalyticsCacheKey(userId: string, section: ManagerAnalyticsSection, params: URLSearchParams) {
  return `manager-analytics:v2:${userId}:${section}:${params.toString()}`;
}

export type ManagerAnalyticsData = {
  summary: {
    totalIncidents: number;
    openIncidents: number;
    criticalIncidents: number;
    averageResponseMinutes: number | null;
    respondingOrganisations: number;
  };
  trend: Array<{ label: string; value: number; responseMinutes: number | null; critical: number; high: number; moderate: number; other: number }>;
  statuses: Array<{ label: string; value: number }>;
  categories: Array<{ label: string; value: number }>;
  severities: Array<{ label: string; value: number }>;
  provinces: Array<{ label: string; value: number }>;
  areas: Array<{ label: string; value: number }>;
  incidents: Array<{
    id: string;
    reference: string;
    category: string;
    severity: string;
    status: string;
    submittedAt: string;
    responseMinutes: number | null;
    organisation: string;
    organisationId: string | null;
    province: string;
    area: string;
    address: string | null;
  }>;
  securityLogs: Array<Record<string, any>>;
  filters: {
    provinces: string[];
    areas: string[];
    organisations: Array<{ id: string; name: string; province: string | null; city: string | null; suburb: string | null }>;
  };
};

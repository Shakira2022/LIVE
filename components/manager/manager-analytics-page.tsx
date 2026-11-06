"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Activity, AlertTriangle, Building2, CalendarDays, Clock3, ShieldAlert, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Select } from "@/components/ui/field";
import { EChart } from "@/components/manager/echart";
import { useAuth } from "@/components/auth/auth-provider";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import {
  managerAnalyticsCacheKey,
  managerAnalyticsParams,
  managerDefaultDates,
  type ManagerAnalyticsData,
  type ManagerAnalyticsSection,
  type ManagerFilters,
  type ManagerGranularity,
} from "@/lib/manager-analytics";

type PageKind = "overview" | "incidents" | "security";
const DISTRIBUTION_COLORS = ["#0f6872", "#53a6a5", "#efaa4b", "#d95751", "#6576a8", "#88a85e", "#9a73aa", "#84929b"];
const SEVERITY_TREND_SERIES = [
  { key: "critical", name: "Critical", color: "#e24b55" },
  { key: "high", name: "High", color: "#f39b38" },
  { key: "moderate", name: "Moderate", color: "#4e7cf5" },
  { key: "other", name: "Other", color: "#94a3b8" },
] as const;

function labelFor(value: string) {
  return String(value || "Unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatMinutes(value: number | null) {
  if (value === null) return "No response data";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function FilterBar({
  filters,
  options,
  onChange,
}: {
  filters: ManagerFilters;
  options?: ManagerAnalyticsData["filters"];
  onChange: (next: ManagerFilters) => void;
}) {
  const provinces = options?.provinces ?? [];
  const scopedOrganisations = (options?.organisations ?? []).filter((organisation) =>
    (!filters.province || organisation.province === filters.province)
    && (!filters.area || organisation.city === filters.area || organisation.suburb === filters.area),
  );
  const areas = [...new Set(scopedOrganisations.flatMap((organisation) => [organisation.city, organisation.suburb]).filter((area): area is string => Boolean(area)))].sort();
  const organisations = scopedOrganisations;
  return (
    <Panel className="border-0">
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">From
          <input aria-label="From date" type="date" value={filters.from} onChange={(event) => onChange({ ...filters, from: event.target.value })} className="h-10 min-w-0 rounded-lg border border-[#d6e0e5] bg-white px-3 text-sm font-medium text-[#102b3f]" />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">To
          <input aria-label="To date" type="date" value={filters.to} onChange={(event) => onChange({ ...filters, to: event.target.value })} className="h-10 min-w-0 rounded-lg border border-[#d6e0e5] bg-white px-3 text-sm font-medium text-[#102b3f]" />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">Group by
          <Select aria-label="Group results by time period" value={filters.granularity} onChange={(event) => onChange({ ...filters, granularity: event.target.value as ManagerGranularity })}>
            <option value="day">Day</option><option value="month">Month</option><option value="year">Year</option>
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">Province
          <Select aria-label="Filter by province" value={filters.province} onChange={(event) => onChange({ ...filters, province: event.target.value, area: "", organisationId: "" })}>
            <option value="">All provinces</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">Area
          <Select aria-label="Filter by area" value={filters.area} onChange={(event) => onChange({ ...filters, area: event.target.value, organisationId: "" })}>
            <option value="">All areas</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">Organisation
          <Select aria-label="Filter by organisation" value={filters.organisationId} onChange={(event) => onChange({ ...filters, organisationId: event.target.value })}>
            <option value="">All organisations</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
          </Select>
        </label>
      </div>
    </Panel>
  );
}

function BarChart({ title, subtitle, items, emptyLabel = "No records for this period", height = 270 }: { title: string; subtitle?: string; items: Array<{ label: string; value: number }>; emptyLabel?: string; height?: number }) {
  const rankedItems = useMemo(() => [...items].sort((a, b) => b.value - a.value).slice(0, 8), [items]);
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 500,
    grid: { left: 10, right: 38, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", axisLabel: { color: "#84929b", fontSize: 11 }, splitLine: { lineStyle: { color: "#edf1f3" } }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: [...rankedItems].reverse().map((item) => labelFor(item.label)), axisLabel: { color: "#617582", fontSize: 11, width: 112, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: "bar", data: [...rankedItems].reverse().map((item) => item.value), barMaxWidth: 24, itemStyle: { color: "#13828a", borderRadius: [0, 6, 6, 0] }, label: { show: true, position: "right", color: "#102b3f", fontWeight: 700, fontSize: 11 } }],
  }), [rankedItems]);
  return <Panel className="min-w-0 rounded-2xl border border-[#dce5ea] shadow-sm">
    <PanelHeader title={title} description={subtitle} action={<span className="rounded-full bg-[#edf5f6] px-2.5 py-1 text-xs font-bold tabular-nums text-[#0f6872]">{items.reduce((sum, item) => sum + item.value, 0)}</span>} />
    {rankedItems.length ? <div className="px-4 py-3"><EChart option={option} height={height} label={title} /></div> : <p className="px-5 py-8 text-sm text-[#7b8c96]">{emptyLabel}</p>}
  </Panel>;
}

function DistributionChart({ title, subtitle, items, compact = false }: { title: string; subtitle?: string; items: Array<{ label: string; value: number }>; compact?: boolean }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 650,
    color: DISTRIBUTION_COLORS,
    tooltip: { trigger: "item", borderWidth: 0, backgroundColor: "#102b3f", textStyle: { color: "#fff" }, formatter: "{b}<br/><strong>{c}</strong> incidents ({d}%)" },
    series: [{ type: "pie", radius: ["58%", "82%"], center: ["50%", "50%"], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false }, itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 5 }, emphasis: { scale: true, scaleSize: 8 }, data: items.map((item) => ({ name: labelFor(item.label), value: item.value })) }],
  }), [items]);
  return <Panel className="min-w-0 rounded-2xl border border-[#dce5ea] shadow-sm">
    <PanelHeader title={title} description={subtitle} action={<span className="rounded-full bg-[#edf5f6] px-2.5 py-1 text-xs font-bold tabular-nums text-[#0f6872]">{total}</span>} />
    {total ? <div className={`grid items-center gap-4 ${compact ? "p-4" : "gap-5 p-5 sm:grid-cols-[minmax(140px,.8fr)_1.2fr]"}`}>
      <div className={`relative mx-auto h-40 w-full ${compact ? "max-w-[170px]" : "max-w-[190px]"}`}>
        <EChart option={option} height={160} label={title} />
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><strong className="text-2xl font-bold text-[#102b3f]">{total}</strong><span className="text-[10px] font-semibold uppercase tracking-wide text-[#718490]">Incidents</span></div>
      </div>
      <div className={`grid gap-3 ${compact ? "grid-cols-2 xl:grid-cols-1" : ""}`}>
        {items.slice(0, 8).map((item, index) => <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span className="flex min-w-0 items-center gap-2 text-[#617582]"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length] }} /><span className="truncate">{labelFor(item.label)}</span></span>
          <span className="shrink-0 font-bold tabular-nums text-[#102b3f]">{item.value}<span className="ml-1 font-medium text-[#81909a]">{Math.round(item.value / total * 100)}%</span></span>
        </div>)}
      </div>
    </div> : <p className="px-5 py-8 text-sm text-[#7b8c96]">No records for this period.</p>}
  </Panel>;
}

function VolumeTrendChart({ items, granularity }: { items: ManagerAnalyticsData["trend"]; granularity: ManagerGranularity }) {
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 700,
    grid: { left: 46, right: 24, top: 28, bottom: 42 },
    tooltip: { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#94a3b8", type: "dashed" } }, borderWidth: 0, backgroundColor: "#102b3f", textStyle: { color: "#fff" } },
    xAxis: { type: "category", data: items.map((item) => item.label), axisTick: { alignWithLabel: true }, axisLine: { lineStyle: { color: "#dce5ea" } }, axisLabel: { color: "#718490", fontSize: 10, interval: Math.max(0, Math.ceil(items.length / 7) - 1), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(1, Math.ceil(value.max * 1.15)), axisLabel: { color: "#84929b", fontSize: 10 }, splitLine: { lineStyle: { color: "#e8eef1", type: "dashed" } } },
    series: [{ name: "Incidents", type: "line", smooth: 0.28, showSymbol: items.length <= 31, symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#4e7cf5" }, itemStyle: { color: "#4e7cf5", borderWidth: 2, borderColor: "#fff" }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(78,124,245,.25)" }, { offset: 1, color: "rgba(78,124,245,.015)" }] } }, emphasis: { focus: "series" }, data: items.map((item) => item.value) }],
  }), [items]);
  return <Panel className="min-w-0 rounded-2xl border border-[#dce5ea] shadow-sm">
    <PanelHeader title="Incident volume" description={`Incident count by ${granularity}`} action={<span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs font-bold text-[#456ad0]">{items.length} {granularity === "day" ? "DAYS" : granularity === "month" ? "MONTHS" : "YEARS"}</span>} />
    {items.some((item) => item.value > 0) ? <div className="px-4 py-2"><EChart option={option} height={350} label="Incident volume line chart by period" /></div> : <div className="grid h-80 place-items-center px-5 text-center text-sm text-[#7b8c96]">No incidents match this date range. Adjust the filters to see volume trends.</div>}
  </Panel>;
}

function SeverityTrendChart({ items }: { items: ManagerAnalyticsData["trend"] }) {
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 650,
    color: SEVERITY_TREND_SERIES.map((entry) => entry.color),
    grid: { left: 42, right: 20, top: 22, bottom: 52 },
    tooltip: { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#94a3b8", type: "dashed" } }, borderWidth: 0, backgroundColor: "#102b3f", textStyle: { color: "#fff" } },
    legend: { bottom: 4, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: "#617582", fontSize: 10 } },
    xAxis: { type: "category", data: items.map((item) => item.label), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dce5ea" } }, axisLabel: { color: "#718490", fontSize: 10, interval: Math.max(0, Math.ceil(items.length / 7) - 1), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(1, Math.ceil(value.max * 1.15)), axisLabel: { color: "#84929b", fontSize: 10 }, splitLine: { lineStyle: { color: "#e8eef1", type: "dashed" } } },
    series: SEVERITY_TREND_SERIES.map((entry) => ({ name: entry.name, type: "line", smooth: 0.22, showSymbol: items.length <= 20, symbolSize: 5, connectNulls: true, lineStyle: { width: 2.5 }, emphasis: { focus: "series" }, data: items.map((item) => item[entry.key]) })),
  }), [items]);
  return <Panel className="min-w-0 rounded-2xl border border-[#dce5ea] shadow-sm">
    <PanelHeader title="Severity over time" description="How incident priority changes across the selected period" />
    {items.some((item) => item.value > 0) ? <div className="px-3 py-2"><EChart option={option} height={260} label="Line chart of incidents by severity over time" /></div> : <div className="grid h-64 place-items-center px-5 text-center text-sm text-[#7b8c96]">Severity trends will appear when incidents are recorded.</div>}
  </Panel>;
}

function ResponseTrendChart({ items, granularity }: { items: ManagerAnalyticsData["trend"]; granularity: ManagerGranularity }) {
  const points = items.filter((item) => item.responseMinutes !== null);
  const values = points.map((item) => item.responseMinutes ?? 0);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 650,
    grid: { left: 48, right: 26, top: 22, bottom: 40 },
    tooltip: { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#94a3b8", type: "dashed" } }, borderWidth: 0, backgroundColor: "#102b3f", textStyle: { color: "#fff" }, valueFormatter: (value) => `${value} min` },
    xAxis: { type: "category", data: points.map((item) => item.label), axisTick: { alignWithLabel: true }, axisLine: { lineStyle: { color: "#dce5ea" } }, axisLabel: { color: "#718490", fontSize: 10, interval: Math.max(0, Math.ceil(points.length / 7) - 1), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(1, Math.ceil(value.max * 1.15)), name: "Minutes", nameTextStyle: { color: "#84929b", fontSize: 10 }, axisLabel: { color: "#84929b", fontSize: 10 }, splitLine: { lineStyle: { color: "#e8eef1", type: "dashed" } } },
    series: [{ type: "line", name: "Average response", data: values, smooth: 0.25, showSymbol: points.length <= 31, symbolSize: 6, lineStyle: { color: "#8b5cf6", width: 2.5 }, itemStyle: { color: "#8b5cf6", borderColor: "#fff", borderWidth: 2 }, areaStyle: { color: "rgba(139,92,246,.10)" }, markLine: { symbol: "none", lineStyle: { color: "#f39b38", type: "dashed", width: 1.5 }, label: { formatter: `Period avg ${Math.round(average)} min`, color: "#9a681e", position: "insideEndTop" }, data: [{ yAxis: average }] } }],
  }), [average, points, values]);
  return <Panel className="min-w-0 rounded-2xl border border-[#dce5ea] shadow-sm">
    <PanelHeader title="Time to first assignment" description={`Average response time by ${granularity}`} action={<span className="rounded-full bg-[#fff3e3] px-2.5 py-1 text-xs font-bold text-[#a96715]">{formatMinutes(values.length ? Math.round(average) : null)}</span>} />
    {values.length ? <div className="px-3 py-2"><EChart option={option} height={260} label="Average time to first assignment by period" /></div> : <div className="grid h-64 place-items-center px-5 text-center text-sm text-[#7b8c96]">Response times will appear when incidents have assignment timestamps.</div>}
  </Panel>;
}

function MetricCard({ title, value, detail, icon: Icon, tone }: { title: string; value: string | number; detail: string; icon: typeof Activity; tone: string }) {
  return <Panel className="relative border border-[#dce5ea] rounded-2xl p-4 shadow-sm sm:p-5">
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0f6872] to-[#76b9ad]" />
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-[#718490]">{title}</p><p className="mt-2 text-3xl font-bold tracking-tight text-[#102b3f]">{value}</p><p className="mt-1 text-xs text-[#718490]">{detail}</p></div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5"/></span></div>
  </Panel>;
}

export function ManagerAnalyticsPage({ kind }: { kind: PageKind }) {
  const { user } = useAuth();
  const defaultDates = managerDefaultDates();
  const [filters, setFilters] = useState<ManagerFilters>({ ...defaultDates, granularity: "day", province: "", area: "", organisationId: "" });
  const section: ManagerAnalyticsSection = kind === "security" ? "security" : "overview";
  const params = useMemo(() => managerAnalyticsParams(filters, section), [filters, section]);
  const queryString = params.toString();
  const cacheKey = user?.id ? managerAnalyticsCacheKey(user.id, section, params) : "";
  const [data, setData] = useState<ManagerAnalyticsData | null>(() => cacheKey ? readCached<ManagerAnalyticsData>(cacheKey) : null);
  const [loading, setLoading] = useState(() => !(cacheKey && readCached<ManagerAnalyticsData>(cacheKey)));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const cached = readCached<ManagerAnalyticsData>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    else if (!data) setLoading(true);
    if (data || cached) setRefreshing(true);
    setError("");
    const refresh = () => {
      if (!cancelled) setRefreshing(true);
      return fetch(`/api/manager/analytics?${queryString}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.ok === false) throw new Error(payload?.message || "Unable to load management analytics.");
        const next = (payload?.data ?? payload) as ManagerAnalyticsData;
        if (!cancelled) {
          setData(next);
          setLoading(false);
          setRefreshing(false);
          writeFreshCache(cacheKey, next, 5 * 60_000);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load management analytics.");
          setLoading(false);
          setRefreshing(false);
        }
      });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [cacheKey, queryString, user?.id]);

  if (loading && !data) return <PageSkeleton />;
  const sectionTitle = kind === "overview" ? "Management overview" : kind === "incidents" ? "Incident intelligence" : "Security overview";
  const subtitle = kind === "overview"
    ? "Live operational performance across organisations and service areas."
    : kind === "incidents"
      ? "Explore incident volume, severity, status and response performance."
      : "Review security events across the selected operating area.";

  return <div className="app-page grid gap-5">
    <PageHeading eyebrow="Management insights" title={sectionTitle} description={subtitle} />
    <FilterBar filters={filters} options={data?.filters} onChange={setFilters} />
    {refreshing ? <p className="text-xs font-medium text-[#718490]" role="status" aria-live="polite">Updating this view with the latest data...</p> : null}
    {error ? <div role="status" className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm text-[#a93331]">{error}</div> : null}
    {loading && data ? <p className="text-xs font-medium text-[#718490]" aria-live="polite">Refreshing with the latest data…</p> : null}

    {kind !== "security" && data ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Incidents" value={data.summary.totalIncidents} detail="In the selected period" icon={Siren} tone="bg-[#edf5f6] text-[#0f6872]" />
        <MetricCard title="Open incidents" value={data.summary.openIncidents} detail="Requiring operational follow-up" icon={Activity} tone="bg-[#fff3e3] text-[#a96715]" />
        <MetricCard title="Critical priority" value={data.summary.criticalIncidents} detail="Critical incidents in this period" icon={AlertTriangle} tone="bg-[#fff0ef] text-[#b94039]" />
        <MetricCard title="Average response" value={formatMinutes(data.summary.averageResponseMinutes)} detail={`${data.summary.respondingOrganisations} organisations represented`} icon={Clock3} tone="bg-[#edf6ef] text-[#36784b]" />
      </div>
      {kind === "overview" ? <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8"><VolumeTrendChart items={data.trend} granularity={filters.granularity} /></div>
        <div className="min-w-0 xl:col-span-4"><DistributionChart title="Incident severity" subtitle="Share of incidents by severity" items={data.severities} compact /></div>
        <div className="min-w-0 xl:col-span-7"><SeverityTrendChart items={data.trend} /></div>
        <div className="min-w-0 xl:col-span-5"><ResponseTrendChart items={data.trend} granularity={filters.granularity} /></div>
        <div className="min-w-0 xl:col-span-5"><BarChart title="Top incident categories" subtitle="Most frequent incident types" items={data.categories} height={230} /></div>
        <div className="min-w-0 xl:col-span-3"><DistributionChart title="Incident status" subtitle="Current status mix" items={data.statuses} compact /></div>
        <div className="min-w-0 xl:col-span-4"><BarChart title="Most affected areas" subtitle="Incident count by area" items={data.areas} height={230} /></div>
      </div> : <>
        <div className="grid gap-4 lg:grid-cols-2"><DistributionChart title="Severity mix" subtitle="Share of incidents by severity" items={data.severities} /><BarChart title="Incident categories" items={data.categories} /><VolumeTrendChart items={data.trend} granularity={filters.granularity} /></div>
        <Panel className="border-0">
          <PanelHeader title={`${data.incidents.length} incidents`} description="Incident records matching the selected filters." />
          <div className="max-h-[60vh] overflow-auto overscroll-contain">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm"><thead className="sticky top-0 bg-[#f4f7f8] text-xs uppercase tracking-wide text-[#748693]"><tr>{["Reference", "Submitted", "Category", "Severity", "Status", "Organisation", "Area", "Response"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#e2e8ed]">{data.incidents.map((incident) => <tr key={incident.id} className="hover:bg-[#f8fafb]"><td className="px-4 py-3 font-semibold text-[#102b3f]">{incident.reference}</td><td className="whitespace-nowrap px-4 py-3 text-[#617582]">{formatDate(incident.submittedAt)}</td><td className="px-4 py-3">{labelFor(incident.category)}</td><td className="px-4 py-3"><Badge tone={incident.severity === "critical" ? "danger" : incident.severity === "high" ? "warning" : "slate"}>{labelFor(incident.severity)}</Badge></td><td className="px-4 py-3">{labelFor(incident.status)}</td><td className="max-w-52 truncate px-4 py-3" title={incident.organisation}>{incident.organisation}</td><td className="px-4 py-3">{incident.area}</td><td className="whitespace-nowrap px-4 py-3">{formatMinutes(incident.responseMinutes)}</td></tr>)}</tbody></table>
            {!data.incidents.length ? <p className="p-6 text-sm text-[#718490]">No incidents match the selected filters.</p> : null}
          </div>
        </Panel>
      </>}
    </> : null}

    {kind === "security" && data ? <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard title="Security events" value={data.securityLogs.length} detail="Matching the selected filters" icon={ShieldAlert} tone="bg-[#fff0ef] text-[#b94039]" />
        <MetricCard title="Incidents in period" value={data.summary.totalIncidents} detail="Same date and location filters" icon={Siren} tone="bg-[#edf5f6] text-[#0f6872]" />
        <MetricCard title="Organisations" value={data.summary.respondingOrganisations} detail="Represented by incidents" icon={Building2} tone="bg-[#edf6ef] text-[#36784b]" />
      </div>
      <Panel className="border-0">
        <PanelHeader title={`${data.securityLogs.length} security events`} description="Most recent events are listed first." action={<Badge tone="slate"><CalendarDays className="mr-1 h-3 w-3"/>{filters.from} – {filters.to}</Badge>} />
        <div className="max-h-[65vh] overflow-auto overscroll-contain">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead className="sticky top-0 bg-[#f4f7f8] text-xs uppercase tracking-wide text-[#748693]"><tr>{["Time", "Event", "Actor", "Result", "IP address", "Context"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#e2e8ed]">{data.securityLogs.map((log, index) => {
            const metadata = log.safe_metadata ?? log.metadata ?? {};
            const event = log.event_type ?? log.action ?? log.event ?? log.type ?? "Security event";
            const actor = log.actor_email ?? log.user_email ?? log.actor_user_id ?? log.user_id ?? "System";
            const result = log.result ?? log.outcome ?? log.severity ?? "Recorded";
            const context = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
            return <tr key={String(log.id ?? `${event}-${index}`)} className="align-top hover:bg-[#f8fafb]"><td className="whitespace-nowrap px-4 py-3 text-[#617582]">{formatDate(log.created_at ?? log.timestamp)}</td><td className="px-4 py-3 font-semibold text-[#102b3f]">{labelFor(event)}</td><td className="max-w-48 truncate px-4 py-3" title={String(actor)}>{String(actor)}</td><td className="px-4 py-3"><Badge tone={/fail|denied|critical|high/i.test(String(result)) ? "danger" : "slate"}>{labelFor(String(result))}</Badge></td><td className="px-4 py-3 font-mono text-xs">{log.ip_address ?? log.ip ?? "—"}</td><td className="max-w-72 truncate px-4 py-3 text-xs text-[#617582]" title={context}>{context && context !== "{}" ? context : "—"}</td></tr>;
          })}</tbody></table>
          {!data.securityLogs.length ? <p className="p-6 text-sm text-[#718490]">No security events match the selected filters.</p> : null}
        </div>
      </Panel>
    </> : null}
  </div>;
}

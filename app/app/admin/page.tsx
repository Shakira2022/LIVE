"use client";

import Link from "next/link";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Building2,
    Clock,
    Download,
    CheckCircle2,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Siren,
    Users,
} from "lucide-react";

import {
    useCallback,
    useEffect,
    useState,
} from "react";

import { Metric } from "@/components/dashboard/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Panel,
    PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { formatDateTime } from "@/lib/utils";

interface DashboardMetrics {
    users: number;
    organisations: number;
    deniedEvents: number;
    submittedRequests: number;
    completedRequests: number;
    successEvents: number;
    totalEvents: number;
}

interface RequestTrend {
    date: string;
    submitted: number;
    completed: number;
}

interface HourlyTrend {
    hour: string;
    submitted: number;
    completed: number;
}

interface SeverityCount {
    severity: string;
    count: number;
}

const SEVERITY_ORDER = ["critical", "high", "moderate", "medium", "low"];

const SEVERITY_COLOURS: Record<string, string> = {
    critical: "#c0392b",
    high: "#d9822b",
    moderate: "#c9a227",
    medium: "#c9a227",
    low: "#1f845b",
};

function severityRank(severity: string) {
    const index = SEVERITY_ORDER.indexOf(severity);

    return index === -1 ? SEVERITY_ORDER.length : index;
}

function formatSeverity(severity: string) {
    const text = severity.replace(/_/g, " ");

    return text.charAt(0).toUpperCase() + text.slice(1);
}

interface PeriodTotal {
    submitted: number;
    completed: number;
}

interface Insights {
    stuckRequests?: {
        total: number;
        items: {
            id: string;
            severity: string;
            submittedAt: string;
            waitingMinutes: number;
        }[];
    };
    health?: { title: string; detail: string; ok: boolean }[];
    severityTrends?: {
        daily: { date: string; counts: Record<string, number> }[];
        hourly: { hour: string; counts: Record<string, number> }[];
    };
    generatedAt?: string;
}

function formatMinutes(value: number | null) {
    if (value === null) {
        return "No data";
    }

    if (value < 1) {
        return "Under 1 min";
    }

    if (value < 60) {
        return `${Math.round(value)} min`;
    }

    return `${(value / 60).toFixed(1)} h`;
}

type TrendRange = "24h" | "7d" | "30d" | "90d";

const RANGE_OPTIONS: { value: TrendRange; label: string }[] = [
    { value: "24h", label: "24 hours" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
];

interface RawRequestTrend {
    date: string;
    submitted?: number;
    completed?: number;
    total?: number;
}

interface DashboardAuditLog {
    id: string;
    action: string;
    actorName: string;
    target: string;
    result:
    | "success"
    | "denied"
    | "warning"
    | "failure";
    timestamp: string;
}

interface DashboardResponse {
    ok?: boolean;

    data?: {
        metrics?: Partial<DashboardMetrics>;
        requestTrends?: RawRequestTrend[];
        hourlyTrends?: HourlyTrend[];
        severityBreakdown?: Record<string, SeverityCount[]>;
        periodTotals?: Record<string, PeriodTotal>;
        auditLogs?: DashboardAuditLog[];
    };

    metrics?: Partial<DashboardMetrics>;
    auditLogs?: DashboardAuditLog[];

    message?: string;

    error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
    };
}

const EMPTY_METRICS: DashboardMetrics = {
    users: 0,
    organisations: 0,
    deniedEvents: 0,
    submittedRequests: 0,
    completedRequests: 0,
    successEvents: 0,
    totalEvents: 0,
};

function getApiMessage(
    result: DashboardResponse | null,
    fallback: string
) {
    if (!result) {
        return fallback;
    }

    if (typeof result.error === "string") {
        return result.error;
    }

    if (
        result.error &&
        typeof result.error === "object"
    ) {
        const firstDetail =
            result.error.details
                ? Object.values(
                    result.error.details
                )
                    .flat()
                    .find(Boolean)
                : undefined;

        return (
            firstDetail ||
            result.error.message ||
            result.message ||
            fallback
        );
    }

    return result.message || fallback;
}

async function readJson<T>(
    response: Response
): Promise<T | null> {
    try {
        return (await response.json()) as T;
    } catch {
        return null;
    }
}

async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> {
    const requestInit: RequestInit = {
        ...init,
        credentials: "include",
    };

    let response = await fetch(
        input,
        requestInit
    );

    if (response.status !== 401) {
        return response;
    }

    const refreshResponse =
        await fetch(
            "/api/auth/refresh",
            {
                method: "POST",
                credentials: "include",
                cache: "no-store",
            }
        );

    if (!refreshResponse.ok) {
        return response;
    }

    response = await fetch(
        input,
        requestInit
    );

    return response;
}

function normaliseTrends(
    trends: RawRequestTrend[] | undefined
): RequestTrend[] {
    if (!Array.isArray(trends)) {
        return [];
    }

    return trends.map((day) => ({
        date: day.date,
        submitted: day.submitted ?? day.total ?? 0,
        completed: day.completed ?? 0,
    }));
}

export default function AdminHome() {
    const {
        user,
        loading: authLoading,
        refresh,
    } = useAuth();

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [metrics, setMetrics] =
        useState<DashboardMetrics>(
            EMPTY_METRICS
        );

    const [auditLogs, setAuditLogs] =
        useState<DashboardAuditLog[]>([]);

    const [requestTrends, setRequestTrends] =
        useState<RequestTrend[]>([]);

    const [hourlyTrends, setHourlyTrends] =
        useState<HourlyTrend[]>([]);

    const [severityBreakdown, setSeverityBreakdown] =
        useState<Record<string, SeverityCount[]>>({});

    const [periodTotals, setPeriodTotals] =
        useState<Record<string, PeriodTotal>>({});

    const [insights, setInsights] =
        useState<Insights | null>(null);

    const [range, setRange] =
        useState<TrendRange>("30d");

    const rangeDays =
        range === "7d" ? 7 : range === "30d" ? 30 : 90;

    const loadDashboard =
        useCallback(async (silent = false) => {
            if (!user?.id) {
                setMetrics(EMPTY_METRICS);
                setAuditLogs([]);
                setRequestTrends([]);
                setHourlyTrends([]);
                setSeverityBreakdown({});
                setPeriodTotals({});
                setInsights(null);
                setLoading(false);
                return;
            }

            try {
                if (!silent) {
                    setLoading(true);
                }

                setError("");

                const response =
                    await authenticatedFetch(
                        "/api/admin/dashboard",
                        {
                            method: "GET",
                            cache: "no-store",
                        }
                    );

                const result =
                    await readJson<DashboardResponse>(
                        response
                    );

                if (!response.ok) {
                    if (response.status === 401) {
                        await refresh();
                    }

                    setError(
                        getApiMessage(
                            result,
                            "Unable to load the administration dashboard."
                        )
                    );

                    return;
                }

                const nextMetrics: DashboardMetrics = {
                    ...EMPTY_METRICS,
                    ...(result?.data?.metrics ??
                        result?.metrics ??
                        {}),
                };

                const nextAuditLogs =
                    result?.data?.auditLogs ??
                    result?.auditLogs ??
                    [];

                setMetrics(nextMetrics);

                setAuditLogs(
                    Array.isArray(nextAuditLogs)
                        ? nextAuditLogs
                        : []
                );

                setRequestTrends(
                    normaliseTrends(
                        result?.data?.requestTrends
                    )
                );

                setHourlyTrends(
                    Array.isArray(result?.data?.hourlyTrends)
                        ? result.data.hourlyTrends
                        : []
                );

                setSeverityBreakdown(
                    result?.data?.severityBreakdown ?? {}
                );

                setPeriodTotals(
                    result?.data?.periodTotals ?? {}
                );

                setInsights(
                    (result?.data ?? null) as unknown as Insights | null
                );
            } catch (err) {
                console.warn(
                    "Unable to load admin dashboard:",
                    err instanceof Error
                        ? err.message
                        : String(err)
                );

                setError(
                    "Unable to connect to the administration dashboard service."
                );
            } finally {
                setLoading(false);
            }
        }, [
            refresh,
            user?.id,
        ]);

    useEffect(() => {
        if (authLoading) {
            return;
        }

        if (!user?.id) {
            setLoading(false);
            return;
        }

        void loadDashboard();
    }, [
        authLoading,
        loadDashboard,
        user?.id,
    ]);

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        const timer = setInterval(() => {
            void loadDashboard(true);
        }, 30_000);

        return () => clearInterval(timer);
    }, [loadDashboard, user?.id]);

    if (
        authLoading ||
        loading ||
        !user
    ) {
        return <PageSkeleton />;
    }

    const completionRate =
        metrics.submittedRequests > 0
            ? Math.round(
                (metrics.completedRequests /
                    metrics.submittedRequests) *
                100
            )
            : 0;

    const stuck = insights?.stuckRequests;

    function exportCsv() {
        const rows = [
            "period,submitted,completed",
            ...chartData.map(
                (point) =>
                    `${point.label},${point.submitted},${point.completed}`
            ),
        ];

        const blob = new Blob([rows.join("\n")], {
            type: "text/csv",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `request-activity-${range}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    const severityPoints =
        range === "24h"
            ? (insights?.severityTrends?.hourly ?? []).map((point) => ({
                key: point.hour,
                label: new Date(point.hour).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                }),
                counts: point.counts,
            }))
            : (insights?.severityTrends?.daily ?? [])
                .slice(-rangeDays)
                .map((point) => ({
                    key: point.date,
                    label: point.date,
                    counts: point.counts,
                }));

    const severityKeys = [
        ...new Set(
            severityPoints.flatMap((point) => Object.keys(point.counts))
        ),
    ].sort((a, b) => severityRank(a) - severityRank(b));

    const severityMax = Math.max(
        1,
        ...severityPoints.flatMap((point) => Object.values(point.counts))
    );

    const severityTicks = [
        ...new Set([0, Math.ceil(severityMax / 2), severityMax]),
    ];

    const chartX = (index: number) =>
        30 +
        (severityPoints.length > 1
            ? index / (severityPoints.length - 1)
            : 0.5) *
        560;

    const chartY = (value: number) =>
        150 - (value / severityMax) * 130;

    const successRate =
        metrics.totalEvents > 0
            ? Math.round(
                (metrics.successEvents / metrics.totalEvents) * 100
            )
            : 0;

    const deniedRate =
        metrics.totalEvents > 0
            ? Math.round(
                (metrics.deniedEvents / metrics.totalEvents) * 100
            )
            : 0;

    const chartData =
        range === "24h"
            ? hourlyTrends.map((hour) => ({
                key: hour.hour,
                label: new Date(hour.hour).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" }
                ),
                submitted: hour.submitted,
                completed: hour.completed,
            }))
            : requestTrends.slice(-rangeDays).map((day) => ({
                key: day.date,
                label: day.date,
                submitted: day.submitted,
                completed: day.completed,
            }));

    const rangeSubmitted =
        periodTotals[range]?.submitted ??
        chartData.reduce((sum, point) => sum + point.submitted, 0);

    const rangeCompleted =
        periodTotals[range]?.completed ??
        chartData.reduce((sum, point) => sum + point.completed, 0);

    const maxRequestTrend = Math.max(
        1,
        ...chartData.flatMap((point) => [
            point.submitted,
            point.completed,
        ])
    );

    const barHeight = (value: number) =>
        value === 0
            ? "0%"
            : `${Math.max(
                4,
                (value / maxRequestTrend) * 100
            )}%`;

    const severityItems = [
        ...(severityBreakdown[range] ?? []),
    ].sort(
        (a, b) =>
            severityRank(a.severity) - severityRank(b.severity)
    );

    const severityTotal = severityItems.reduce(
        (sum, item) => sum + item.count,
        0
    );

    // Calculate Waiting Assignment Statistics
    const waitingItems = stuck?.items ?? [];
    const totalWaiting = stuck?.total ?? waitingItems.length;
    const criticalWaiting = waitingItems.filter((i) => i.severity === "critical").length;
    const avgWaitingMinutes =
        waitingItems.length > 0
            ? Math.round(
                waitingItems.reduce((acc, curr) => acc + curr.waitingMinutes, 0) /
                waitingItems.length
            )
            : 0;

    const waitingBuckets = [
        { label: "< 15 min", count: waitingItems.filter((i) => i.waitingMinutes < 15).length, color: "#1f845b" },
        { label: "15–30 min", count: waitingItems.filter((i) => i.waitingMinutes >= 15 && i.waitingMinutes <= 30).length, color: "#c9a227" },
        { label: "30–60 min", count: waitingItems.filter((i) => i.waitingMinutes > 30 && i.waitingMinutes <= 60).length, color: "#d9822b" },
        { label: "> 60 min", count: waitingItems.filter((i) => i.waitingMinutes > 60).length, color: "#c0392b" },
    ];
    const maxBucketCount = Math.max(1, ...waitingBuckets.map((b) => b.count));

    return (
        <div className="app-page grid gap-5">
            <PageHeading
                eyebrow="Administration"
                title="System overview"
                description="Review platform activity, identities, organisations and security events."
            />

            <div className="flex items-center justify-end gap-3">
                <span className="flex items-center gap-1.5 text-xs text-[#687b89]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#1f845b]" />
                    Live
                    {insights?.generatedAt
                        ? `, updated ${new Date(insights.generatedAt).toLocaleTimeString()}`
                        : ""}
                </span>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={exportCsv}
                >
                    <Download className="h-4 w-4" />
                    Export CSV
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadDashboard()}
                >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {error ? (
                <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
                    {error}
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                    label="Requests submitted"
                    value={metrics.submittedRequests}
                    detail="All time"
                    icon={
                        <Siren className="h-5 w-5" />
                    }
                />

                <Metric
                    label="Requests completed"
                    value={metrics.completedRequests}
                    detail={`${completionRate}% of all submitted`}
                    icon={
                        <CheckCircle2 className="h-5 w-5" />
                    }
                />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                    label="Users"
                    value={metrics.users}
                    detail="All time, across all roles"
                    icon={
                        <Users className="h-5 w-5" />
                    }
                />

                <Metric
                    label="Organisations"
                    value={metrics.organisations}
                    detail="Configured response endpoints"
                    icon={
                        <Building2 className="h-5 w-5" />
                    }
                />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                    label="Successful events"
                    value={metrics.successEvents}
                    detail={`${successRate}% of all logged events`}
                    icon={
                        <ShieldCheck className="h-5 w-5" />
                    }
                />

                <Metric
                    label="Denied events"
                    value={metrics.deniedEvents}
                    tone="warning"
                    detail={`${deniedRate}% of all logged events`}
                    icon={
                        <ShieldAlert className="h-5 w-5" />
                    }
                />
            </div>

            <Panel>
                <PanelHeader
                    title="Request activity"
                    description={`${rangeSubmitted} submitted, ${rangeCompleted} completed in this period`}
                    action={
                        <div className="flex gap-1">
                            {RANGE_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                        setRange(option.value)
                                    }
                                    aria-pressed={
                                        range === option.value
                                    }
                                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${range === option.value
                                        ? "bg-[#167d8d] text-white"
                                        : "text-[#687b89] hover:bg-[#eef3f6]"
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    }
                />

                <div className="px-5 pb-5">
                    <div className="mb-3 flex gap-4 text-xs text-[#687b89]">
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-[#167d8d]" />
                            Submitted
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-[#1f845b]" />
                            Completed
                        </span>
                    </div>

                    <div
                        className={`flex h-40 items-end border-b border-[#e2e8ed] ${chartData.length > 30
                            ? "gap-px"
                            : "gap-1"
                            }`}
                        role="img"
                        aria-label="Bar chart of requests submitted and completed over the selected period"
                    >
                        {chartData.map((point) => (
                            <div
                                key={point.key}
                                className="flex h-full flex-1 items-end gap-px"
                                title={`${point.label}: ${point.submitted} submitted, ${point.completed} completed`}
                            >
                                <div
                                    className="w-1/2 rounded-t bg-[#167d8d]"
                                    style={{
                                        height: barHeight(
                                            point.submitted
                                        ),
                                    }}
                                />
                                <div
                                    className="w-1/2 rounded-t bg-[#1f845b]"
                                    style={{
                                        height: barHeight(
                                            point.completed
                                        ),
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    {chartData.length > 0 ? (
                        <div className="mt-2 flex justify-between text-xs text-[#687b89]">
                            <span>
                                {chartData[0].label}
                            </span>
                            <span>
                                {
                                    chartData[
                                        chartData.length - 1
                                    ].label
                                }
                            </span>
                        </div>
                    ) : null}

                    {rangeSubmitted === 0 &&
                        rangeCompleted === 0 ? (
                        <p className="mt-3 text-sm text-[#687b89]">
                            No requests in this period.
                        </p>
                    ) : null}
                </div>
            </Panel>

            <Panel>
                <PanelHeader
                    title="Requests by critical condition"
                    description={`${severityTotal} submitted in the period selected above`}
                />

                {severityTotal === 0 ? (
                    <div className="px-5 pb-5 text-sm text-[#687b89]">
                        No requests in this period.
                    </div>
                ) : (
                    <div className="grid gap-6 p-5 lg:grid-cols-2">
                        {/* Left: Trend Line Chart */}
                        <div className="space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-[#687b89]">Trend over time</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#687b89]">
                                {severityItems.map((item) => (
                                    <span
                                        key={item.severity}
                                        className="flex items-center gap-1.5"
                                    >
                                        <span
                                            className="h-2 w-2 rounded-sm"
                                            style={{
                                                backgroundColor:
                                                    SEVERITY_COLOURS[item.severity] ?? "#167d8d",
                                            }}
                                        />
                                        {formatSeverity(item.severity)}
                                    </span>
                                ))}
                            </div>

                            <svg
                                viewBox="0 0 600 170"
                                className="h-44 w-full"
                                role="img"
                                aria-label="Line chart of requests over time by critical condition"
                            >
                                {severityTicks.map((tick) => (
                                    <g key={tick}>
                                        <line
                                            x1="30"
                                            x2="590"
                                            y1={chartY(tick)}
                                            y2={chartY(tick)}
                                            stroke="#e2e8ed"
                                        />
                                        <text
                                            x="24"
                                            y={chartY(tick) + 4}
                                            textAnchor="end"
                                            fontSize="10"
                                            fill="#687b89"
                                        >
                                            {tick}
                                        </text>
                                    </g>
                                ))}

                                {severityKeys.map((key) => {
                                    const colour =
                                        SEVERITY_COLOURS[key] ?? "#167d8d";

                                    return (
                                        <g key={key}>
                                            <polyline
                                                fill="none"
                                                stroke={colour}
                                                strokeWidth="2"
                                                strokeLinejoin="round"
                                                points={severityPoints
                                                    .map(
                                                        (point, index) =>
                                                            `${chartX(index)},${chartY(point.counts[key] ?? 0)}`
                                                    )
                                                    .join(" ")}
                                            />

                                            {severityPoints.length <= 31
                                                ? severityPoints.map((point, index) => (
                                                    <circle
                                                        key={point.key}
                                                        cx={chartX(index)}
                                                        cy={chartY(point.counts[key] ?? 0)}
                                                        r="3"
                                                        fill={colour}
                                                    >
                                                        <title>
                                                            {`${point.label}: ${point.counts[key] ?? 0} ${formatSeverity(key).toLowerCase()}`}
                                                        </title>
                                                    </circle>
                                                ))
                                                : null}
                                        </g>
                                    );
                                })}
                            </svg>

                            {severityPoints.length > 0 ? (
                                <div className="flex justify-between pl-[30px] text-xs text-[#687b89]">
                                    <span>{severityPoints[0].label}</span>
                                    <span>
                                        {severityPoints[severityPoints.length - 1].label}
                                    </span>
                                </div>
                            ) : null}
                        </div>

                        {/* Right: Summary Bar Graph */}
                        <div className="flex flex-col justify-center space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-[#687b89]">Period distribution</p>
                            <div className="space-y-3">
                                {severityItems.map((item) => {
                                    const percentage = severityTotal > 0 ? Math.round((item.count / severityTotal) * 100) : 0;
                                    const colour = SEVERITY_COLOURS[item.severity] ?? "#167d8d";
                                    return (
                                        <div key={item.severity} className="space-y-1">
                                            <div className="flex justify-between text-xs font-medium">
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-sm"
                                                        style={{ backgroundColor: colour }}
                                                    />
                                                    {formatSeverity(item.severity)}
                                                </span>
                                                <span className="text-[#687b89]">
                                                    {item.count} <span className="text-xs font-normal">({percentage}%)</span>
                                                </span>
                                            </div>
                                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#e2e8ed]">
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{
                                                        width: `${percentage}%`,
                                                        backgroundColor: colour,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </Panel>

            {/* Clean Queue Section with Charts and No Item Lines */}
            <div className="grid gap-4">
                <Panel>
                    <PanelHeader
                        title="Queue Duration & Responder Time Analytics"
                        description={`${totalWaiting} active requests currently awaiting responder assignment`}
                    />

                    {!stuck || waitingItems.length === 0 ? (
                        <div className="px-5 pb-5 text-sm text-[#687b89]">
                            No unassigned requests.
                        </div>
                    ) : (
                        <div className="space-y-6 p-5">
                            {/* KPI Cards */}
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg border border-[#e2e8ed] bg-[#f8fafc] p-3.5">
                                    <div className="flex items-center gap-2 text-xs text-[#687b89]">
                                        <Clock className="h-4 w-4 text-[#167d8d]" />
                                        Total Unassigned
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-[#1e293b]">
                                        {totalWaiting}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-[#e2e8ed] bg-[#f8fafc] p-3.5">
                                    <div className="flex items-center gap-2 text-xs text-[#687b89]">
                                        <AlertTriangle className="h-4 w-4 text-[#c0392b]" />
                                        Critical Priority
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-[#c0392b]">
                                        {criticalWaiting}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-[#e2e8ed] bg-[#f8fafc] p-3.5">
                                    <div className="flex items-center gap-2 text-xs text-[#687b89]">
                                        <Activity className="h-4 w-4 text-[#d9822b]" />
                                        Avg. Wait Duration
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-[#1e293b]">
                                        {avgWaitingMinutes} <span className="text-xs font-normal text-[#687b89]">mins</span>
                                    </p>
                                </div>
                            </div>

                            {/* Distribution Bar Chart */}
                            <div className="rounded-xl border border-[#e2e8ed] p-4">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#687b89]">
                                    Waiting Time Frequency
                                </p>
                                <div className="flex h-32 items-end justify-between gap-2 border-b border-[#e2e8ed] pb-2">
                                    {waitingBuckets.map((bucket) => {
                                        const pct = (bucket.count / maxBucketCount) * 100;
                                        return (
                                            <div key={bucket.label} className="flex flex-1 flex-col items-center justify-end gap-1 h-full">
                                                <span className="text-xs font-semibold text-[#687b89]">
                                                    {bucket.count}
                                                </span>
                                                <div
                                                    className="w-full max-w-[48px] rounded-t transition-all"
                                                    style={{
                                                        height: `${Math.max(6, pct)}%`,
                                                        backgroundColor: bucket.color,
                                                    }}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-2 flex justify-between text-xs font-medium text-[#687b89]">
                                    {waitingBuckets.map((bucket) => (
                                        <span key={bucket.label} className="flex-1 text-center">
                                            {bucket.label}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Plain Queue List - No Red Progress Bar Lines */}
                            <div>
                                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#687b89]">
                                    Unassigned Requests Queue
                                </p>
                                <div className="divide-y divide-[#e2e8ed] rounded-xl border border-[#e2e8ed]">
                                    {waitingItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between gap-3 p-4 sm:px-5"
                                        >
                                            <div>
                                                <p className="font-semibold text-[#1e293b]">
                                                    {formatSeverity(item.severity)} request
                                                </p>
                                                <p className="text-xs text-[#88969f]">
                                                    Submitted {formatDateTime(item.submittedAt)}
                                                </p>
                                            </div>

                                            <Badge
                                                tone={
                                                    item.severity === "critical"
                                                        ? "danger"
                                                        : "warning"
                                                }
                                            >
                                                {formatMinutes(item.waitingMinutes)}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                    <PanelHeader
                        title="Latest audit activity"
                        action={
                            <Link href="/app/admin/audit">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                >
                                    View all
                                    <ArrowRight className="h-4 w-4" />
                                </Button>
                            </Link>
                        }
                    />

                    {auditLogs.length === 0 ? (
                        <div className="p-5 text-sm text-[#687b89]">
                            No audit activity has been
                            recorded yet.
                        </div>
                    ) : (
                        <div className="divide-y divide-[#e2e8ed]">
                            {auditLogs.map((log) => (
                                <article
                                    key={log.id}
                                    className="p-4 sm:p-5"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="font-semibold">
                                                {log.action}
                                            </h3>

                                            <p className="mt-1 text-sm text-[#617582]">
                                                {log.actorName} ·{" "}
                                                {log.target}
                                            </p>

                                            <p className="mt-2 text-xs text-[#88969f]">
                                                {formatDateTime(
                                                    log.timestamp
                                                )}
                                            </p>
                                        </div>

                                        <Badge
                                            tone={
                                                log.result === "success"
                                                    ? "success"
                                                    : log.result ===
                                                        "denied"
                                                        ? "danger"
                                                        : "warning"
                                            }
                                        >
                                            {log.result}
                                        </Badge>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel>
                    <PanelHeader
                        title="Platform health"
                        description="Connected system checks"
                    />

                    <div className="divide-y divide-[#e2e8ed]">
                        {(insights?.health ?? []).map((item) => (
                            <div
                                key={item.title}
                                className="flex items-center gap-3 p-4 sm:p-5"
                            >
                                <span
                                    className={`h-2.5 w-2.5 rounded-full ${item.ok
                                        ? "bg-[#1f845b]"
                                        : "bg-[#b97018]"
                                        }`}
                                />

                                <div className="flex-1">
                                    <p className="font-semibold">
                                        {item.title}
                                    </p>

                                    <p className="mt-1 text-sm text-[#687b89]">
                                        {item.detail}
                                    </p>
                                </div>

                                <Activity className="h-4 w-4 text-[#8a9aa4]" />
                            </div>
                        ))}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
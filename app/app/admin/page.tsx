"use client";

import Link from "next/link";
import {
    ArrowRight,
    Building2,
    Flag,
    LifeBuoy,
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
import { timeAgo } from "@/lib/utils";
import { readCached, writeFreshCache } from "@/lib/client-cache";

interface DashboardMetrics {
    users: number;
    organisations: number;
    activeRequests: number;
    openSupportRequests: number;
    openResponderReports: number;
}

interface DashboardSupportRequest {
    id: string;
    requesterName: string;
    subject: string;
    status: string;
    updatedAt: string;
}

interface DashboardResponderReport {
    id: string;
    responderName: string;
    subject: string;
    createdAt: string;
}


interface DashboardResponse {
    ok?: boolean;

    data?: {
        metrics?: DashboardMetrics;
        supportRequests?: DashboardSupportRequest[];
        responderReports?: DashboardResponderReport[];
    };

    /*
     * Compatibility with the older non-middleware response.
     */
    metrics?: DashboardMetrics;
    supportRequests?: DashboardSupportRequest[];
    responderReports?: DashboardResponderReport[];

    message?: string;

    error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
    };
}

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

export default function AdminHome() {
    const {
        user,
        loading: authLoading,
        refresh,
    } = useAuth();

    const dashboardCacheKey = user?.id ? `admin-dashboard:v2:${user.id}` : null;
    const cachedDashboard = dashboardCacheKey
        ? readCached<{ metrics: DashboardMetrics; supportRequests: DashboardSupportRequest[]; responderReports: DashboardResponderReport[] }>(dashboardCacheKey)
        : null;

    const [loading, setLoading] =
        useState(() => !cachedDashboard);

    const [error, setError] =
        useState("");

    const [metrics, setMetrics] =
        useState<DashboardMetrics>(() => cachedDashboard?.metrics ?? {
            users: 0,
            organisations: 0,
            activeRequests: 0,
            openSupportRequests: 0,
            openResponderReports: 0,
        });

    const [supportRequests, setSupportRequests] =
        useState<DashboardSupportRequest[]>(() => cachedDashboard?.supportRequests ?? []);

    const [responderReports, setResponderReports] =
        useState<DashboardResponderReport[]>(() => cachedDashboard?.responderReports ?? []);

    const loadDashboard =
        useCallback(async () => {
            if (!user?.id) {
                setMetrics({
                    users: 0,
                    organisations: 0,
                    activeRequests: 0,
                    openSupportRequests: 0,
                    openResponderReports: 0,
                });
                setSupportRequests([]);
                setResponderReports([]);
                setLoading(false);
                return;
            }

            try {
                if (!dashboardCacheKey || !readCached(dashboardCacheKey)) setLoading(true);
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

                /*
                 * createHandler() wraps successful route results as:
                 *
                 * {
                 *   ok: true,
                 *   data: { metrics, supportRequests, responderReports },
                 *   requestId: "..."
                 * }
                 *
                 * The compatibility fallbacks support older response shapes.
                 */
                const nextMetrics =
                    result?.data?.metrics ??
                    result?.metrics ??
                    {
                        users: 0,
                        organisations: 0,
                        activeRequests: 0,
                        openSupportRequests: 0,
                        openResponderReports: 0,
                    };

                const nextSupportRequests =
                    result?.data?.supportRequests ??
                    result?.supportRequests ??
                    [];

                const nextResponderReports =
                    result?.data?.responderReports ??
                    result?.responderReports ??
                    [];

                setMetrics(nextMetrics);
                setSupportRequests(Array.isArray(nextSupportRequests) ? nextSupportRequests : []);
                setResponderReports(Array.isArray(nextResponderReports) ? nextResponderReports : []);
                if (dashboardCacheKey) {
                    writeFreshCache(dashboardCacheKey, {
                        metrics: nextMetrics,
                        supportRequests: Array.isArray(nextSupportRequests) ? nextSupportRequests : [],
                        responderReports: Array.isArray(nextResponderReports) ? nextResponderReports : [],
                    }, 5 * 60_000);
                }
            } catch (error) {
                console.warn(
                    "Unable to load admin dashboard:",
                    error instanceof Error
                        ? error.message
                        : String(error)
                );

                setError(
                    "Unable to connect to the administration dashboard service."
                );
            } finally {
                setLoading(false);
            }
        }, [
            dashboardCacheKey,
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

    if (
        authLoading ||
        loading ||
        !user
    ) {
        return <PageSkeleton />;
    }

    return (
        <div className="app-page grid gap-5">
            <PageHeading
                eyebrow="Administration"
                title="System overview"
                description="Monitor emergency requests, support enquiries and responder reports."
            />

            {error ? (
                <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
                    {error}
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                    label="Users"
                    value={metrics.users}
                    detail="Across all roles"
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

                <Metric
                    label="Active requests"
                    value={metrics.activeRequests}
                    tone="danger"
                    detail="Operational lifecycle"
                    icon={
                        <Siren className="h-5 w-5" />
                    }
                />

                <Metric
                    label="Open support requests"
                    value={metrics.openSupportRequests}
                    tone="warning"
                    detail="Need administrator attention"
                    icon={<LifeBuoy className="h-5 w-5" />}
                />

                <Metric
                    label="Open responder reports"
                    value={metrics.openResponderReports}
                    tone={metrics.openResponderReports > 0 ? "warning" : "success"}
                    detail="Awaiting administrator review"
                    icon={<Flag className="h-5 w-5" />}
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                    <PanelHeader
                        title="Support requests needing attention"
                        description={`${metrics.openSupportRequests} open or waiting support requests`}
                        action={
                            <Link href="/app/admin/support">
                                <Button variant="ghost" size="sm">
                                    View all
                                    <ArrowRight className="h-4 w-4" />
                                </Button>
                            </Link>
                        }
                    />
                    {supportRequests.length === 0 ? (
                        <div className="p-5 text-sm text-[#687b89]">No support requests need attention.</div>
                    ) : (
                        <div role="region" aria-label="Support requests needing attention" tabIndex={0} className="max-h-[45vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
                            {supportRequests.map((request) => (
                                <article key={request.id} className="flex items-start justify-between gap-3 p-4 sm:p-5">
                                    <div className="min-w-0">
                                        <h3 className="truncate font-semibold">{request.subject || "Support request"}</h3>
                                        <p className="mt-1 text-sm text-[#617582]">{request.requesterName} · Updated {timeAgo(request.updatedAt)}</p>
                                    </div>
                                    <Badge tone={request.status === "open" ? "warning" : "slate"}>{request.status.replaceAll("_", " ")}</Badge>
                                </article>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel>
                    <PanelHeader
                        title="Responder reports awaiting review"
                        description={`${metrics.openResponderReports} open reports`}
                        action={
                            <Link href="/app/admin/reports">
                                <Button variant="ghost" size="sm">
                                    View all
                                    <ArrowRight className="h-4 w-4" />
                                </Button>
                            </Link>
                        }
                    />
                    {responderReports.length === 0 ? (
                        <div className="p-5 text-sm text-[#687b89]">No responder reports are awaiting review.</div>
                    ) : (
                        <div role="region" aria-label="Responder reports awaiting review" tabIndex={0} className="max-h-[45vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
                            {responderReports.map((report) => (
                                <article key={report.id} className="flex items-start justify-between gap-3 p-4 sm:p-5">
                                    <div className="min-w-0">
                                        <h3 className="truncate font-semibold">{report.subject}</h3>
                                        <p className="mt-1 text-sm text-[#617582]">{report.responderName} · Reported {timeAgo(report.createdAt)}</p>
                                    </div>
                                    <Badge tone="warning">Open</Badge>
                                </article>
                            ))}
                        </div>
                    )}
                </Panel>
            </div>
        </div>
    );
}

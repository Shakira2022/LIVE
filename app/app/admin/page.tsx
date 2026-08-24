"use client";

import Link from "next/link";
import {
    Activity,
    ArrowRight,
    Building2,
    ShieldAlert,
    Siren,
    Users,
} from "lucide-react";

import {
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
import { formatDateTime } from "@/lib/utils";

interface DashboardMetrics {
    users: number;
    organisations: number;
    activeRequests: number;
    deniedEvents: number;
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

export default function AdminHome() {
    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [metrics, setMetrics] =
        useState<DashboardMetrics>({
            users: 0,
            organisations: 0,
            activeRequests: 0,
            deniedEvents: 0,
        });

    const [auditLogs, setAuditLogs] =
        useState<DashboardAuditLog[]>([]);

    async function loadDashboard() {
        try {
            setLoading(true);
            setError("");

            const response = await fetch(
                "/api/admin/dashboard"
            );

            const result =
                await response.json();

            if (!response.ok || !result.ok) {
                setError(
                    result.message ||
                    "Unable to load the administration dashboard."
                );

                return;
            }

            setMetrics(
                result.metrics ?? {
                    users: 0,
                    organisations: 0,
                    activeRequests: 0,
                    deniedEvents: 0,
                }
            );

            setAuditLogs(
                result.auditLogs ?? []
            );
        } catch {
            setError(
                "Unable to connect to the administration dashboard service."
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadDashboard();
    }, []);

    if (loading) {
        return <PageSkeleton />;
    }

    return (
        <div className="app-page grid gap-5">
            <PageHeading
                eyebrow="Administration"
                title="System overview"
                description="Review platform activity, identities, organisations and security events."
            />

            {error ? (
                <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
                    {error}
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                    label="Denied events"
                    value={metrics.deniedEvents}
                    tone="warning"
                    detail="Security review"
                    icon={
                        <ShieldAlert className="h-5 w-5" />
                    }
                />
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
                        {[
                            {
                                title: "Authentication",
                                detail:
                                    "JWT authentication with protected administrator routes",
                                ok: true,
                            },
                            {
                                title: "Database",
                                detail:
                                    "Supabase PostgreSQL backend",
                                ok: true,
                            },
                            {
                                title:
                                    "Organisation management",
                                detail:
                                    "Organisation status management connected",
                                ok: true,
                            },
                            {
                                title: "Audit logging",
                                detail:
                                    "Administrative changes are recorded",
                                ok: true,
                            },
                        ].map((item) => (
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

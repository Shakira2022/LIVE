"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, CheckCircle2, Flag, LoaderCircle, PhoneCall, Search, ShieldAlert } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useCall } from "@/components/calls/call-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import { FieldLabel, Input, Textarea } from "@/components/ui/field";
import { authenticatedFetch } from "@/lib/client-api";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { formatDateTime, timeAgo } from "@/lib/utils";

type AdminUserSummary = {
  id: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
};

type ResponderReport = {
  id: string;
  responder_user_id: string;
  organisation_id: string;
  reported_by_user_id: string;
  subject: string;
  details: string;
  status: "open" | "resolved";
  resolution_action: "none" | "suspended" | "no_suspension";
  resolution_note: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  responder: AdminUserSummary | null;
  reporter: AdminUserSummary | null;
  resolved_by: AdminUserSummary | null;
  organisation_name: string;
};

type ReportNotification = {
  id: string;
  responder_report_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

type AdminReportsCache = {
  reports: ResponderReport[];
  notifications: ReportNotification[];
};

function userName(user: AdminUserSummary | null) {
  return user?.display_name?.trim() || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.email || "Unknown user";
}

function isResponderReportNotification(notification: ReportNotification) {
  return notification.notification_type === "responder_report" || notification.notification_type.startsWith("responder_report_");
}

export default function AdminResponderReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const { call, startCall } = useCall();
  const cacheKey = user?.id ? `admin-responder-reports:v1:${user.id}` : "";
  const initialCache = cacheKey ? readCached<AdminReportsCache>(cacheKey) : null;
  const [reports, setReports] = useState<ResponderReport[]>(() => initialCache?.reports ?? []);
  const [notifications, setNotifications] = useState<ReportNotification[]>(() => initialCache?.notifications ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("open");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReport, setSelectedReport] = useState<ResponderReport | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const fetchInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!user?.id || document.visibilityState === "hidden" || fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const [reportsResponse, notificationsResponse] = await Promise.all([
        authenticatedFetch("/api/admin/responder-reports", { cache: "no-store" }),
        authenticatedFetch("/api/notifications", { cache: "no-store" }),
      ]);
      const [reportsPayload, notificationsPayload] = await Promise.all([
        reportsResponse.json().catch(() => ({})),
        notificationsResponse.json().catch(() => ({})),
      ]);
      if (!reportsResponse.ok) throw new Error(reportsPayload?.error?.message || reportsPayload?.message || "Unable to load responder reports.");
      if (!notificationsResponse.ok) throw new Error(notificationsPayload?.error?.message || notificationsPayload?.message || "Unable to load report notifications.");

      const nextReports = reportsPayload?.data?.reports ?? reportsPayload?.reports ?? [];
      const nextNotifications = notificationsPayload?.data?.notifications ?? notificationsPayload?.notifications ?? [];
      const reportNotifications = nextNotifications.filter(isResponderReportNotification);
      setReports(nextReports);
      setNotifications(reportNotifications);
      if (cacheKey) writeFreshCache(cacheKey, { reports: nextReports, notifications: reportNotifications }, 5_000);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load responder reports.");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [cacheKey, user?.id]);

  useEffect(() => {
    if (authLoading || !user) return;
    const cached = cacheKey ? readCached<AdminReportsCache>(cacheKey) : null;
    if (cached) {
      setReports(cached.reports);
      setNotifications(cached.notifications);
      setLoading(false);
    }
    const fresh = cacheKey ? readFreshCache<AdminReportsCache>(cacheKey) : null;
    if (!fresh) void load();
    const timer = window.setInterval(() => void load(), 5_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authLoading, cacheKey, load, user]);

  async function openReport(report: ResponderReport) {
    setSelectedReport(report);
    setResolutionNote("");
    setResolveError("");
    setSuccessMessage("");
    const unread = notifications.filter((item) => item.responder_report_id === report.id && !item.read_at);
    const readResults = await Promise.all(unread.map(async (notification) => {
      const response = await authenticatedFetch(`/api/notifications/${notification.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      return response.ok ? notification.id : null;
    }));
    const readIds = new Set(readResults.filter(Boolean));
    if (readIds.size) {
      const nextNotifications = notifications.map((notification) => readIds.has(notification.id)
        ? { ...notification, read_at: new Date().toISOString() }
        : notification);
      setNotifications(nextNotifications);
      if (cacheKey) writeFreshCache(cacheKey, { reports, notifications: nextNotifications }, 5_000);
      window.dispatchEvent(new Event("live:notifications-changed"));
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((notification) => !notification.read_at);
    if (!unread.length) return;

    const readResults = await Promise.all(unread.map(async (notification) => {
      const response = await authenticatedFetch(`/api/notifications/${notification.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      return response.ok ? notification.id : null;
    }));
    const readIds = new Set(readResults.filter(Boolean));
    if (readIds.size) {
      const readAt = new Date().toISOString();
      const nextNotifications = notifications.map((notification) => readIds.has(notification.id)
        ? { ...notification, read_at: readAt }
        : notification);
      setNotifications(nextNotifications);
      if (cacheKey) writeFreshCache(cacheKey, { reports, notifications: nextNotifications }, 5_000);
      window.dispatchEvent(new Event("live:notifications-changed"));
    }
  }

  async function resolveReport(suspendResponder: boolean) {
    if (!selectedReport) return;
    setResolving(true);
    setResolveError("");
    setSuccessMessage("");
    try {
      const response = await authenticatedFetch(`/api/admin/responder-reports/${selectedReport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ suspendResponder, resolutionNote }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || payload?.message || "Unable to resolve this report.");
      }
      const updated = payload?.data?.report ?? payload?.report;
      const nextReports = reports.map((report) => report.id === selectedReport.id ? { ...report, ...updated } : report);
      setReports(nextReports);
      if (cacheKey) writeFreshCache(cacheKey, { reports: nextReports, notifications }, 5_000);
      setSelectedReport(null);
      setSuccessMessage(suspendResponder ? "Report resolved and responder suspended." : "Report resolved without suspending the responder.");
    } catch (resolveError) {
      setResolveError(resolveError instanceof Error ? resolveError.message : "Unable to resolve this report.");
    } finally {
      setResolving(false);
    }
  }

  if (authLoading || !user || (loading && reports.length === 0 && !initialCache && !error)) return <PageSkeleton />;

  const unreadReportCount = notifications.filter((notification) => !notification.read_at).length;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleReports = reports.filter((report) => {
    const matchesStatus = statusFilter === "all" || report.status === statusFilter;
    const matchesSearch = !normalizedSearch || [
      report.subject,
      userName(report.responder),
      userName(report.reporter),
      report.organisation_name,
      report.details,
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="Responder reports"
        description="Review reports submitted by dispatchers and record the action taken."
      />

      {successMessage ? <p role="status" className="rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-3 text-sm text-[#27684e]">{successMessage}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{error}</p> : null}

      <section aria-label="Filter responder reports" className="grid gap-4 rounded-xl border border-[#dce5ea] bg-white px-4 py-4 sm:grid-cols-[minmax(220px,1fr)_minmax(180px,240px)] sm:items-end sm:px-5">
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          <FieldLabel>Search reports</FieldLabel>
          <span className="relative">
            <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80919c]" />
            <Input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Subject, responder, reporter, or organisation" className="pl-6" />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          <FieldLabel>Report status</FieldLabel>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "open" | "resolved")} className="h-12 border-0 border-b border-[#cbd7de] bg-transparent px-0 text-sm text-[#102b3f] outline-none focus:border-b-2 focus:border-[#0f5b67]">
            <option value="open">Open reports</option>
            <option value="resolved">Resolved reports</option>
            <option value="all">All reports</option>
          </select>
        </label>
        <p className="text-xs text-[#71828d] sm:col-span-2">Showing {visibleReports.length} of {reports.length} reports</p>
      </section>

      <Panel mobileCard={false} className="border-0 bg-white md:rounded-[22px]">
        <PanelHeader
          title={visibleReports.length === 1 ? "1 report" : `${visibleReports.length} reports`}
          description={`${unreadReportCount} unread · New reports are checked automatically while this page is open.`}
          className="items-center px-4 py-3"
          action={<Button variant="ghost" size="sm" disabled={!unreadReportCount} onClick={() => void markAllRead()}><CheckCheck className="h-4 w-4" />Mark all read</Button>}
        />
        {visibleReports.length ? (
          <div className="h-[55vh] min-h-[280px] max-h-[70vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
            {visibleReports.map((report) => {
              const responderName = userName(report.responder);
              const unread = notifications.some((notification) => notification.responder_report_id === report.id && !notification.read_at);
              return (
                <button key={report.id} type="button" onClick={() => void openReport(report)} className={`flex w-full items-start gap-3 px-4 py-4 text-left outline-none transition focus-visible:bg-[#edf5f6] sm:px-5 ${unread ? "bg-[#f2f9f9]" : "bg-white"}`}>
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${unread ? "bg-[#e7f3f4] text-[#0f6872]" : "bg-[#f2f6f8] text-[#788a96]"}`}>
                    {report.status === "open" ? <Flag className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#102b3f]">{report.subject}</span>
                        <Badge tone={report.status === "open" ? "warning" : "success"}>{report.status}</Badge>
                      </span>
                      <span className="shrink-0 text-xs text-[#7a8a95]">{timeAgo(report.created_at)}</span>
                    </span>
                    <span className="mt-1 block text-sm text-[#536b7b]">{responderName} · {report.organisation_name}</span>
                    <span className="mt-1 block text-xs text-[#7a8a95]">Reported by {userName(report.reporter)}</span>
                    <span className="mt-2 line-clamp-2 block text-sm leading-5 text-[#5d7382]">{report.details}</span>
                    <span className="mt-2 inline-block text-xs font-semibold text-[#0f5b67]">{report.status === "open" ? "Review report" : "View resolution"}</span>
                  </span>
                  {unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#0f5b67]" aria-label="Unread report" /> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No responder reports" description={normalizedSearch ? "No reports match your search and status filters." : statusFilter === "open" ? "New reports from dispatchers will appear here." : "There are no reports in this status."} />
        )}
      </Panel>
      <Sheet
        open={Boolean(selectedReport)}
        onOpenChange={(open) => { if (!open && !resolving) { setSelectedReport(null); setResolveError(""); } }}
        title="Responder report"
        description={selectedReport?.subject}
        side="right"
        className="h-[100dvh] max-h-[100dvh] max-w-xl"
        dismissible={!resolving}
      >
        {selectedReport ? (
          <div className="space-y-6 px-5 py-4 sm:px-6">
            <div className="space-y-2 px-1 py-1">
              <p className="font-semibold text-[#102b3f]">{userName(selectedReport.responder)}</p>
              <p className="text-sm text-[#617582]">{selectedReport.responder?.email}</p>
              <p className="text-sm text-[#617582]">{selectedReport.responder?.phone || "No phone number on file"}</p>
              <p className="text-xs text-[#71828d]">{selectedReport.organisation_name}</p>
            </div>
            <div className="grid gap-2 text-sm">
              <p><span className="font-semibold text-[#536b7b]">Reported by:</span> {userName(selectedReport.reporter)}</p>
              <p><span className="font-semibold text-[#536b7b]">Submitted:</span> {formatDateTime(selectedReport.created_at)}</p>
            </div>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#748693]">Report details</h3>
              <p className="mt-3 whitespace-pre-wrap rounded-xl border border-[#e2e8ed] bg-white p-4 text-sm leading-7 text-[#344c5a]">{selectedReport.details}</p>
            </section>
            {selectedReport.status === "resolved" ? (
              <>
                <div className="space-y-3 rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-4 text-sm text-[#27684e]">
                  <p className="font-semibold">Resolved: {selectedReport.resolution_action === "suspended" ? "Responder suspended" : "No suspension"}</p>
                  {selectedReport.resolution_note ? <p className="leading-6">{selectedReport.resolution_note}</p> : null}
                  {selectedReport.resolved_at ? <p className="text-xs">{formatDateTime(selectedReport.resolved_at)}</p> : null}
                </div>
                <Button type="button" variant="outline" className="w-full" disabled={call.status !== "idle" || selectedReport.reporter?.status !== "active"} onClick={() => void startCall(`dispatcher:${selectedReport.reported_by_user_id}`, userName(selectedReport.reporter), { targetRole: "dispatcher", targetUserId: selectedReport.reported_by_user_id })}>
                  <PhoneCall className="h-4 w-4" />Call dispatcher
                </Button>
              </>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="w-full" disabled={call.status !== "idle" || selectedReport.responder?.status !== "active"} onClick={() => void startCall(`responder:${selectedReport.responder_user_id}`, userName(selectedReport.responder), { targetRole: "responder", targetUserId: selectedReport.responder_user_id })}>
                    <PhoneCall className="h-4 w-4" />Call responder
                  </Button>
                  <Button type="button" variant="outline" className="w-full" disabled={call.status !== "idle" || selectedReport.reporter?.status !== "active"} onClick={() => void startCall(`dispatcher:${selectedReport.reported_by_user_id}`, userName(selectedReport.reporter), { targetRole: "dispatcher", targetUserId: selectedReport.reported_by_user_id })}>
                    <PhoneCall className="h-4 w-4" />Call dispatcher
                  </Button>
                </div>
                <label className="block">
                  <FieldLabel>Resolution note (optional)</FieldLabel>
                  <Textarea maxLength={4000} rows={4} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Add a note about how this report was reviewed and resolved, if needed." />
                  <p className="mt-1 text-xs text-[#71828d]">You can resolve the report without adding a note.</p>
                </label>
                {resolveError ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{resolveError}</p> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" disabled={resolving} onClick={() => void resolveReport(false)}>
                    {resolving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Resolve without suspension
                  </Button>
                  <Button type="button" variant="danger" disabled={resolving} onClick={() => void resolveReport(true)}>
                    {resolving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                    Suspend and resolve
                  </Button>
                </div>
                <p className="text-xs leading-5 text-[#71828d]">Suspension blocks responder sign-in and is available after any active emergency assignment is released or completed.</p>
              </>
            )}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

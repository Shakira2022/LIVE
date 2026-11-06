"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ambulance, CheckCircle2, Flag, LoaderCircle, MapPin, PhoneCall, Power, Search, Users } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useCall } from "@/components/calls/call-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { FieldLabel, Input, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { authenticatedFetch } from "@/lib/client-api";

type Responder = {
  user_id: string;
  organisation_id: string;
  availability: string;
  current_latitude: number | null;
  current_longitude: number | null;
  user: { id: string; first_name: string; last_name: string; display_name: string | null; phone: string | null } | null;
};
type ResourcesData = {
  responders: Responder[];
  busyResponderIds: string[];
  activeRequestByResponder: Record<string, string>;
  organisations: Array<{ id: string; name: string }>;
};

function displayName(responder: Responder) {
  return responder.user?.display_name || [responder.user?.first_name, responder.user?.last_name].filter(Boolean).join(" ") || "Responder";
}

export default function Resources() {
  const { user } = useAuth();
  const { call, startCall } = useCall();
  const cacheKey = user?.id ? `dispatcher-resources:v2:${user.id}:${user.organisationId ?? "unassigned"}` : "";
  const reportCacheKey = user?.organisationId
    ? `dispatcher-open-responder-reports:v1:${user.organisationId}`
    : user?.id
      ? `dispatcher-open-responder-reports:v1:user:${user.id}`
      : "";
  const initial = cacheKey ? readCached<ResourcesData>(cacheKey) : null;
  const [resources, setResources] = useState<ResourcesData | null>(() => initial);
  const [loading, setLoading] = useState(() => !initial);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reportResponder, setReportResponder] = useState<{ id: string; name: string } | null>(null);
  const [reportSubject, setReportSubject] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState("");
  const [reportedResponderIdsByCacheKey, setReportedResponderIdsByCacheKey] = useState<Record<string, string[]>>({});
  const reportedResponderIds = reportCacheKey
    ? reportedResponderIdsByCacheKey[reportCacheKey] ?? readCached<string[]>(reportCacheKey) ?? []
    : [];
  const openReportsFetchInFlight = useRef(false);

  const cacheReportedResponderIds = useCallback((ids: string[], key = reportCacheKey) => {
    if (!key) return;
    const uniqueIds = [...new Set(ids)];
    setReportedResponderIdsByCacheKey((current) => ({ ...current, [key]: uniqueIds }));
    writeFreshCache(key, uniqueIds, 5 * 60_000);
  }, [reportCacheKey]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dispatcher/resources", { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) throw new Error(payload?.message || "Unable to load organisation responders.");
      const next = (payload?.data ?? payload) as ResourcesData;
      setResources(next);
      if (cacheKey) writeFreshCache(cacheKey, next, 5 * 60_000);
    } catch (error) {
      console.error("Unable to load dispatcher resources:", error);
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => { void load(); }, [load]);

  const loadOpenReports = useCallback(async () => {
    if (!user?.id || document.visibilityState === "hidden" || openReportsFetchInFlight.current) return;
    openReportsFetchInFlight.current = true;
    try {
      const response = await authenticatedFetch("/api/dispatcher/responder-reports", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) return;
      cacheReportedResponderIds(payload?.data?.responderUserIds ?? payload?.responderUserIds ?? [], reportCacheKey);
    } catch (error) {
      console.warn("Unable to refresh open responder reports:", error instanceof Error ? error.message : String(error));
    } finally {
      openReportsFetchInFlight.current = false;
    }
  }, [cacheReportedResponderIds, reportCacheKey, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadOpenReports();
    const timer = window.setInterval(() => void loadOpenReports(), 5_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void loadOpenReports(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadOpenReports, user?.id]);

  async function submitResponderReport() {
    if (!reportResponder) return;
    setReportSubmitting(true);
    setReportError("");
    try {
      const response = await authenticatedFetch("/api/dispatcher/responder-reports", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responderUserId: reportResponder.id, subject: reportSubject, details: reportDetails }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || payload?.message || "Unable to submit this responder report.");
      }
      cacheReportedResponderIds([...reportedResponderIds, reportResponder.id]);
      setReportSuccess(`Report sent to administrators for ${reportResponder.name}.`);
      setReportResponder(null);
      setReportSubject("");
      setReportDetails("");
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Unable to submit this responder report.");
    } finally {
      setReportSubmitting(false);
    }
  }

  if (loading && !resources) return <PageSkeleton />;

  const organisationName = resources?.organisations?.[0]?.name ?? "Your organisation";
  const busyIds = new Set(resources?.busyResponderIds ?? []);
  const responderCards = (resources?.responders ?? []).map((responder) => {
    const name = displayName(responder);
    const active = busyIds.has(responder.user_id);
    const rawAvailability = String(responder.availability).toLowerCase();
    const availability = active
      ? "Assigned"
      : ["assigned", "en_route", "on_scene"].includes(rawAvailability)
        ? "Offline"
        : rawAvailability.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return {
      responder,
      name,
      active,
      availability,
      rawAvailability,
      requestId: resources?.activeRequestByResponder?.[responder.user_id],
    };
  });
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredResponders = responderCards.filter(({ name, availability, rawAvailability }) => {
    const matchesSearch = !normalizedSearch || [name, availability, rawAvailability.replaceAll("_", " ")]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
    const matchesStatus = statusFilter === "all" || availability.toLowerCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const statusOptions = [...new Set(responderCards.map(({ availability }) => availability))]
    .sort((first, second) => first.localeCompare(second));

  return <div className="app-page grid gap-5">
    <PageHeading eyebrow="Dispatch" title="Response resources" description="View your organisation’s responders and current availability." />
    {!resources?.responders?.length ? (
      <Panel><p className="p-6 text-sm text-[#627683]">No active responders are registered with your organisation.</p></Panel>
    ) : <>
      {reportSuccess ? <p role="status" className="rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-3 text-sm text-[#27684e]">{reportSuccess}</p> : null}
      <section className="grid gap-3 rounded-xl border border-[#dce5ea] bg-white p-4 sm:grid-cols-[minmax(220px,1fr)_minmax(180px,260px)] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          Search responders
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80919c]" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Name or availability"
              className="h-11 w-full rounded-lg border border-[#cbd8df] bg-white pl-9 pr-3 text-[#102b3f] outline-none placeholder:text-[#8b9aa4] focus-visible:ring-2 focus-visible:ring-[#0f6872]"
            />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          Availability status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#cbd8df] bg-white px-3 text-[#102b3f] outline-none focus-visible:ring-2 focus-visible:ring-[#0f6872]">
            <option value="all">All statuses</option>
            {statusOptions.map((availability) => <option key={availability} value={availability.toLowerCase()}>{availability}</option>)}
          </select>
        </label>
        <p className="text-xs text-[#71828d] sm:col-span-2">Showing {filteredResponders.length} of {responderCards.length} responders</p>
      </section>
      {filteredResponders.length === 0 ? (
        <Panel><p className="p-6 text-center text-sm text-[#627683]">No responders match this search or status.</p></Panel>
      ) : <div
      role="region"
      aria-label="Organisation responders"
      tabIndex={0}
      className="max-h-[60vh] touch-pan-y overscroll-contain overflow-y-auto pr-1"
    ><div className="grid gap-4 lg:grid-cols-2">{filteredResponders.map(({ responder, name, active, availability, requestId }) => {
      const lat = Number(responder.current_latitude);
      const lng = Number(responder.current_longitude);
      const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
      const isReported = reportedResponderIds.includes(responder.user_id);
      return <Panel key={responder.user_id}>
        <PanelHeader title={name} description="Response team" action={<Badge tone={active ? "warning" : availability === "Available" ? "success" : "slate"}>{availability}</Badge>} />
        <div className="divide-y divide-[#e2e8ed]">
          <div className="flex gap-3 p-4 sm:p-5"><Ambulance className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">Vehicle</p><p className="mt-1 font-semibold">Not assigned</p></div></div>
          <div className="flex gap-3 p-4 sm:p-5"><Users className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">Organisation</p><p className="mt-1 font-semibold">{organisationName}</p></div></div>
          <div className="flex gap-3 p-4 sm:p-5"><MapPin className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">Last position</p><p className="mt-1 font-semibold">{hasLocation ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Location unavailable"}</p></div></div>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-[#e2e8ed] p-4">
          <Button type="button" variant="outline" className="min-w-0 flex-1" disabled><Power className="h-4 w-4"/>{active ? "On mission" : availability}</Button>
          <Button type="button" variant="outline" className="min-w-0 flex-1" disabled={isReported} onClick={() => { setReportError(""); setReportSubject(""); setReportDetails(""); setReportResponder({ id: responder.user_id, name }); }}>
            {isReported ? <CheckCircle2 className="h-4 w-4" /> : <Flag className="h-4 w-4" />}{isReported ? "Reported" : "Report"}
          </Button>
          <Button type="button" className="min-w-0 flex-1" disabled={!user || call.status !== "idle"} onClick={() => void startCall(requestId ?? `responder:${responder.user_id}`, name, { targetRole: "responder", targetUserId: responder.user_id })}>
            <PhoneCall className="h-4 w-4"/>Call responder
          </Button>
        </div>
      </Panel>;
    })}</div></div>}
      <Sheet
        open={Boolean(reportResponder)}
        onOpenChange={(open) => { if (!reportSubmitting && !open) setReportResponder(null); }}
        title="Report responder"
        description={reportResponder ? `Send a report about ${reportResponder.name} to an administrator for review.` : undefined}
        side="center"
        dismissible={!reportSubmitting}
      >
        {reportResponder ? (
          <form onSubmit={(event) => { event.preventDefault(); void submitResponderReport(); }} className="space-y-4 px-5 py-4 sm:px-6">
            <div className="rounded-xl border border-[#dce5ea] bg-[#f7f9fa] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">Responder</p>
              <p className="mt-1 font-semibold text-[#102b3f]">{reportResponder.name}</p>
            </div>
            <label className="block">
              <FieldLabel>Report subject</FieldLabel>
              <Input required minLength={3} maxLength={160} value={reportSubject} onChange={(event) => setReportSubject(event.target.value)} placeholder="Briefly describe the concern" />
            </label>
            <label className="block">
              <FieldLabel>What happened?</FieldLabel>
              <Textarea required minLength={10} maxLength={5000} rows={6} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Add the details administrators need to review this report." />
            </label>
            <p className="text-xs leading-5 text-[#71828d]">Active reports are sent to administrators. They can contact the responder and decide whether further action is needed.</p>
            {reportError ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{reportError}</p> : null}
            <div className="flex justify-center gap-3 pt-1">
              <Button type="button" variant="outline" disabled={reportSubmitting} onClick={() => setReportResponder(null)}>Cancel</Button>
              <Button type="submit" disabled={reportSubmitting}>
                {reportSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                {reportSubmitting ? "Sending report…" : "Send report"}
              </Button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </>}
  </div>;
}

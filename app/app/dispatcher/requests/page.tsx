"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { RequestListItem } from "@/components/requests/request-list-item";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import { effectiveRequestStatus, formatRequestStatus } from "@/lib/utils";
import { localDateFilterBounds } from "@/lib/date-filter";
import { useAuth } from "@/components/auth/auth-provider";
import { readCached, writeFreshCache } from "@/lib/client-cache";

const PAGE_SIZE = 100;
const STATUSES = ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived", "completed", "closed", "cancelled", "rejected"];

export default function DispatcherRequestsPage() {
  const { user } = useAuth();
  const cacheKey = user?.id ? `dispatcher-requests:v3:${user.id}:${user.organisationId ?? "unassigned"}` : "";
  const initialRequests = cacheKey ? readCached<any[]>(cacheKey) : null;
  const [requests, setRequests] = useState<any[]>(() => initialRequests ?? []);
  const [total, setTotal] = useState(() => initialRequests?.length ?? 0);
  const [loading, setLoading] = useState(() => !initialRequests);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestSequence = useRef(0);
  const defaultView = status === "all" && !dateFrom && !dateTo;
  const filterCacheKey = user?.id
    ? `dispatcher-request-queue:v1:${user.id}:${user.organisationId ?? "unassigned"}:${status}:${dateFrom || "any"}:${dateTo || "any"}`
    : "";

  const loadRequests = useCallback(async (offset = 0, append = false) => {
    const sequence = ++requestSequence.current;
    const dateBounds = localDateFilterBounds(dateFrom, dateTo);
    if (dateBounds.error) {
      setError(dateBounds.error);
      setRequests([]);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    setError("");
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
      const cachedQuery = filterCacheKey
        ? readCached<{ items: any[]; total: number }>(filterCacheKey)
        : null;
      const cachedDefault = defaultView && cacheKey ? readCached<any[]>(cacheKey) : null;
      if (cachedQuery) {
        setRequests(cachedQuery.items);
        setTotal(cachedQuery.total);
      } else if (defaultView && cachedDefault) {
        setRequests(cachedDefault);
        setTotal(cachedDefault.length);
      } else {
        setRequests([]);
        setTotal(0);
      }
    }

    try {
      const params = new URLSearchParams({ scope: "all", limit: String(PAGE_SIZE), offset: String(offset) });
      if (status !== "all") params.set("status", status);
      if (dateBounds.dateFrom) params.set("dateFrom", dateBounds.dateFrom);
      if (dateBounds.dateTo) params.set("dateTo", dateBounds.dateTo);

      const response = await fetch(`/api/requests?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || payload?.message || "Unable to load emergency requests.");
      }

      const requestData = payload?.data?.items ?? payload?.items ?? [];
      const assignmentResults = await Promise.all(requestData.map(async (request: any) => {
        const assignmentResponse = await fetch(`/api/Emergency-request/${request.id}/assignments`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!assignmentResponse.ok) return null;
        const assignmentPayload = await assignmentResponse.json();
        const assignment = assignmentPayload?.assignment;
        if (!assignment || !["assigned", "acknowledged", "en_route", "arrived"].includes(String(assignment.status ?? "").toLowerCase())) return null;
        return { ...assignment, request_id: request.id };
      }));
      if (sequence !== requestSequence.current) return;

      const assignmentByRequest = new Map((assignmentResults.filter(Boolean) as any[]).map((assignment) => [assignment.request_id, assignment]));
      const enrichedRequests = requestData.map((request: any) => {
        const assignment = assignmentByRequest.get(request.id);
        return {
          ...request,
          emergency_request_status: request.currentStatus ?? request.current_status,
          assignment_status: assignment?.status ?? null,
          assignment_id: assignment?.id ?? null,
          responder_user_id: assignment?.responderUserId ?? assignment?.responder_user_id ?? null,
          assigned_at: assignment?.assignedAt ?? assignment?.assigned_at ?? null,
          assigned_by_user_id: assignment?.assignedByUserId ?? assignment?.assigned_by_user_id ?? null,
          current_status: effectiveRequestStatus(request.currentStatus ?? request.current_status, assignment?.status),
        };
      });

      setRequests((current) => append ? [...current, ...enrichedRequests] : enrichedRequests);
      if (!append && offset === 0 && filterCacheKey) {
        writeFreshCache(filterCacheKey, {
          items: enrichedRequests,
          total: payload?.data?.total ?? payload?.total ?? enrichedRequests.length,
        }, 5 * 60_000);
      }
      if (!append && offset === 0 && defaultView && cacheKey) {
        writeFreshCache(cacheKey, enrichedRequests, 5 * 60_000);
      }
      setTotal(payload?.data?.total ?? payload?.total ?? enrichedRequests.length);
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        console.error("Failed to load the organisation request queue:", loadError);
        setError(loadError instanceof Error ? loadError.message : "Unable to load emergency requests.");
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [cacheKey, dateFrom, dateTo, defaultView, filterCacheKey, status]);

  useEffect(() => {
    void loadRequests(0, false);
  }, [loadRequests]);

  if (loading && requests.length === 0 && !error) return <PageSkeleton map />;

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Dispatch operations"
        title="Request queue"
        description="Review requests across every status, including cancelled and completed history."
      />

      <section className="grid gap-3 rounded-xl border border-[#dce5ea] bg-white p-4 sm:grid-cols-[minmax(180px,1fr)_repeat(2,minmax(150px,220px))] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-lg border border-[#cbd8df] bg-white px-3 text-[#102b3f]">
            <option value="all">All statuses</option>
            {STATUSES.map((value) => <option key={value} value={value}>{formatRequestStatus(value)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          From date
          <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="h-11 rounded-lg border border-[#cbd8df] bg-white px-3 text-[#102b3f]" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-[#536b7b]">
          To date
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="h-11 rounded-lg border border-[#cbd8df] bg-white px-3 text-[#102b3f]" />
        </label>
      </section>

      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <section aria-label="Emergency request history" className="overflow-hidden rounded-xl border border-[#dce5ea] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#e2e8ed] px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-semibold text-[#102b3f]">{total} {total === 1 ? "request" : "requests"}</h2>
            <p className="mt-1 text-sm text-[#667b89]">Newest requests first. Cancelled requests remain here for reference.</p>
          </div>
          {loading ? <span className="text-xs text-[#667b89]">Updating…</span> : null}
        </div>

        {requests.length === 0 ? (
          <p className="p-8 text-center text-sm text-[#667b89]">No requests match these filters.</p>
        ) : (
          <div role="region" aria-label="Emergency request queue" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto">
            {requests.map((request) => (
              <Link
                key={request.id}
                href={`/app/dispatcher/requests/${request.id}`}
              >
                <RequestListItem request={request} />
              </Link>
            ))}
          </div>
        )}

        {requests.length < total ? (
          <div className="flex justify-center border-t border-[#e2e8ed] p-4">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loadRequests(requests.length, true)}>
              {loadingMore ? "Loading…" : "Load older requests"}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

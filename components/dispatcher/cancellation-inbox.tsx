"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Clock3, LoaderCircle, PhoneCall, TriangleAlert } from "lucide-react";

import { useCall } from "@/components/calls/call-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { authenticatedFetch } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";

type CancellationRequest = {
  id: string;
  reference: string;
  category: string;
  severity: string;
  requesterId: string;
  requesterName: string | null;
  callbackNumber: string | null;
  cancellationRequestedAt: string | null;
  cancellationReason: string | null;
};

type CancellationResponse = {
  data?: { items?: CancellationRequest[] };
  items?: CancellationRequest[];
  error?: { message?: string };
  message?: string;
};

export function DispatcherCancellationInbox() {
  const { call, startCall } = useCall();
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<CancellationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<CancellationRequest | null>(null);
  const [approving, setApproving] = useState(false);
  const fetchInFlight = useRef(false);

  const loadRequests = useCallback(async () => {
    if (document.visibilityState === "hidden" || fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const response = await authenticatedFetch("/api/dispatcher/cancellations", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CancellationResponse;
      if (!response.ok) throw new Error(payload.error?.message || payload.message || "Unable to load cancellation requests.");
      setRequests(payload.data?.items ?? payload.items ?? []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load cancellation requests.");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 3_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadRequests();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadRequests]);

  async function approveCancellation() {
    if (!selectedRequest) return;
    setApproving(true);
    setActionError("");
    try {
      const response = await authenticatedFetch(`/api/requests/${selectedRequest.id}/cancellation`, {
        method: "PATCH",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as CancellationResponse;
      if (!response.ok) throw new Error(payload.error?.message || payload.message || "Unable to approve this cancellation.");
      setRequests((current) => current.filter((request) => request.id !== selectedRequest.id));
      setActionMessage(`Cancellation approved for ${selectedRequest.reference}.`);
      setSelectedRequest(null);
      await loadRequests();
    } catch (approveError) {
      setActionError(approveError instanceof Error ? approveError.message : "Unable to approve this cancellation.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="relative h-10 w-10 rounded-full"
        aria-label={`Cancellation requests${requests.length ? `, ${requests.length} pending` : ""}`}
        title="Cancellation requests"
        aria-expanded={open}
        onClick={() => { setOpen(true); setActionMessage(""); void loadRequests(); }}
      >
        <Bell className="h-4 w-4" />
        {requests.length ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#d53f3d] px-1 text-[10px] font-bold text-white">{requests.length > 9 ? "9+" : requests.length}</span> : null}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => { if (!approving) { setOpen(nextOpen); if (!nextOpen) setSelectedRequest(null); } }}
        title="Cancellation requests"
        description="Requesters with an assigned responder need dispatcher approval to cancel."
        side="right"
        dismissible={!approving}
      >
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {actionMessage ? <p role="status" className="rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-3 text-sm text-[#27684e]">{actionMessage}</p> : null}
          {error ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{error}</p> : null}
          {loading && requests.length === 0 ? <p className="flex items-center gap-2 py-4 text-sm text-[#617582]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading cancellation requests...</p> : null}
          {!loading && !error && requests.length === 0 ? <div className="py-8 text-center"><Bell className="mx-auto h-7 w-7 text-[#7c909c]" /><p className="mt-3 font-semibold text-[#102b3f]">No pending cancellations</p><p className="mt-1 text-sm text-[#71828d]">New requests will appear here.</p></div> : null}
          {requests.map((request) => (
            <article key={request.id} className="rounded-xl border border-[#dce5ea] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-[#102b3f]">{request.requesterName || "Requester"}</h3>
                  <p className="mt-1 text-sm text-[#617582]">{request.reference} {"\u00b7"} {request.category}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#fff3df] px-2 py-1 text-[10px] font-bold uppercase text-[#a96315]">{request.severity}</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-[#748693]"><Clock3 className="h-3.5 w-3.5" />Cancellation requested {request.cancellationRequestedAt ? timeAgo(request.cancellationRequestedAt) : "recently"}</div>
              {request.cancellationReason ? <p className="mt-2 text-sm leading-5 text-[#617582]">{request.cancellationReason}</p> : null}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="danger" size="sm" className="min-w-0" disabled={approving} onClick={() => { setSelectedRequest(request); setActionError(""); }}>
                  <TriangleAlert className="h-4 w-4" />Cancel request
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-w-0" disabled={call.status !== "idle"} onClick={() => void startCall(request.id, request.requesterName || "Requester", {
                  targetRole: "requester",
                  targetUserId: request.requesterId,
                  requestId: request.id,
                })}>
                  <PhoneCall className="h-4 w-4" />Call requester
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={Boolean(selectedRequest)}
        onOpenChange={(nextOpen) => { if (!nextOpen && !approving) { setSelectedRequest(null); setActionError(""); } }}
        title="Approve cancellation?"
        description={selectedRequest ? `Confirm cancellation of ${selectedRequest.reference}. The request stays active until you confirm.` : undefined}
        side="center"
        dismissible={!approving}
      >
        {selectedRequest ? (
          <div className="space-y-4 px-5 py-4 sm:px-6">
            <div className="rounded-xl border border-[#f0d4b0] bg-[#fff9ef] p-4">
              <p className="font-semibold text-[#102b3f]">{selectedRequest.requesterName || "Requester"}</p>
              <p className="mt-1 text-sm text-[#617582]">{selectedRequest.reference} {"\u00b7"} {selectedRequest.category}</p>
              {selectedRequest.cancellationReason ? <p className="mt-3 text-sm leading-6 text-[#617582]">Reason: {selectedRequest.cancellationReason}</p> : null}
            </div>
            {actionError ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{actionError}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={approving} onClick={() => { setSelectedRequest(null); setActionError(""); }}>Keep request active</Button>
              <Button type="button" variant="danger" disabled={approving} onClick={() => void approveCancellation()}>
                {approving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {approving ? "Approving..." : "Confirm cancellation"}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

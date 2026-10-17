"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, CarFront, CheckCircle2, Clock3, MapPin, UserRound } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";

type RequestDetail = {
  id: string;
  reference?: string | null;
  category?: string | null;
  severity?: string | null;
  currentStatus?: string | null;
  note?: string | null;
  submittedAt?: string | null;
  receivedAt?: string | null;
  assignedAt?: string | null;
  arrivedAt?: string | null;
  closedAt?: string | null;
  location?: { addressText?: string | null; landmark?: string | null } | null;
  assignments?: Array<{
    responderName?: string | null;
    responderEmployeeNumber?: string | null;
    vehicleCallSign?: string | null;
    vehicleRegistrationNumber?: string | null;
    status?: string | null;
    etaMinutes?: number | null;
    assignedAt?: string | null;
    arrivedAt?: string | null;
  }>;
};

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function timeToArrive(submittedAt?: string | null, arrivedAt?: string | null) {
  if (!submittedAt || !arrivedAt) return "Not arrived yet";
  const minutes = Math.max(0, Math.round((new Date(arrivedAt).getTime() - new Date(submittedAt).getTime()) / 60000));
  return minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function RequestDetailsSheet({ requestId, open, onOpenChange, showTrackingButton = false }: { requestId: string | null; open: boolean; onOpenChange: (open: boolean) => void; showTrackingButton?: boolean }) {
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !requestId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/requests/${requestId}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: RequestDetail; message?: string };
        if (!response.ok) throw new Error(payload.message || "Unable to load request details.");
        setRequest(payload.data ?? payload as RequestDetail);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load request details.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, requestId]);

  const assignment = request?.assignments?.[request.assignments.length - 1];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Request details" description="A summary of this emergency request." side="bottom" className="!h-dvh !max-h-dvh rounded-none">
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-[#687b89]">Loading request details...</p> : null}
        {error ? <div className="border border-[#efc9c7] bg-[#fff5f4] p-4 text-sm text-[#a93331]">{error}</div> : null}
        {request && !loading ? (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f6872]">{request.reference || request.id}</p>
              <h2 className="mt-1 text-xl font-bold text-[#102b3f]">{request.category || "Emergency request"}</h2>
              <p className="mt-1 text-sm text-[#687b89]">{request.severity || "Standard"} priority · {request.currentStatus || "submitted"}</p>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex gap-3"><CalendarClock className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">Request date and time</p><p className="mt-1 text-[#687b89]">{formatDate(request.submittedAt)}</p></div></div>
              <div className="flex gap-3"><MapPin className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">Location</p><p className="mt-1 text-[#687b89]">{request.location?.addressText || request.location?.landmark || "Location confirmed"}</p></div></div>
              <div className="flex gap-3"><Clock3 className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">Time to reach location</p><p className="mt-1 text-[#687b89]">{timeToArrive(request.submittedAt, request.arrivedAt)}</p></div></div>
              <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">Reached location</p><p className="mt-1 text-[#687b89]">{request.arrivedAt ? formatDate(request.arrivedAt) : "Not reached yet"}</p></div></div>
            </div>

            <div className="border-t border-[#dce5ea] pt-4">
              <h3 className="font-semibold text-[#102b3f]">Response details</h3>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <div className="flex gap-2"><UserRound className="h-4 w-4 text-[#0f5b67]" /><span><b>Driver:</b> {assignment?.responderName || "Not assigned"}</span></div>
                <div className="flex gap-2"><CarFront className="h-4 w-4 text-[#0f5b67]" /><span><b>Vehicle:</b> {assignment?.vehicleRegistrationNumber || assignment?.vehicleCallSign || "Not assigned"}</span></div>
                <div className="flex gap-2"><span className="text-[#0f5b67]">#</span><span><b>Responder ID:</b> {assignment?.responderEmployeeNumber || "Not assigned"}</span></div>
              </div>
            </div>

            {request.note ? <p className="border-t border-[#dce5ea] pt-4 text-sm leading-6 text-[#687b89]"><b className="text-[#102b3f]">Incident note:</b> {request.note}</p> : null}
          </>
        ) : null}
        </div>
        {request && !loading && showTrackingButton ? (
          <div className="shrink-0 border-t border-[#dce5ea] bg-white p-5 sm:p-6">
            <Link href={`/app/requester/track/${request.id}`} onClick={() => onOpenChange(false)} className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-transparent bg-[#0f5b67] px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(15,91,103,.16)] transition hover:bg-[#0b4b55]">Open current tracking</Link>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

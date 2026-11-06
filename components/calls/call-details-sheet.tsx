"use client";

import { useEffect, useState } from "react";
import { CalendarClock, PhoneCall, UserRound } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { requesterText } from "@/lib/requester-ui";
import type { RequesterLanguage } from "@/lib/requester-language";

type CallDetail = {
  call_id: string;
  status: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  caller?: { name: string; role: string } | null;
  callee?: { name: string; role: string } | null;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not available";
}

function roleLabel(role?: string) {
  return role === "responder" ? "Responder" : role === "dispatcher" ? "Dispatcher" : role === "requester" ? "Requester" : "User";
}

function statusLabel(status: string) {
  return status === "accepted" ? "Picked up" : status === "ringing" ? "Calling" : status === "ended" ? "Completed" : status === "missed" ? "Missed call" : status === "declined" ? "Declined" : status === "failed" ? "Call failed" : status.replaceAll("_", " ");
}

export function CallDetailsSheet({ callId, open, onOpenChange, uiLanguage = "English" }: { callId: string | null; open: boolean; onOpenChange: (open: boolean) => void; uiLanguage?: RequesterLanguage }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !callId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    let firstLoad = true;
    const loadCall = async () => {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`, { credentials: "include", cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { data?: { call?: CallDetail }; call?: CallDetail; message?: string };
        if (!response.ok) throw new Error(payload.message || "Unable to load call details.");
        setCall(payload.data?.call ?? payload.call ?? null);
        setError("");
      } catch (reason) {
        if ((reason as { name?: string })?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load call details.");
      } finally {
        if (firstLoad) {
          setLoading(false);
          firstLoad = false;
        }
      }
    };
    void loadCall();
    const timer = window.setInterval(() => void loadCall(), 2000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [callId, open]);

  const t = (text: string) => requesterText(uiLanguage, text);
  return <Sheet open={open} onOpenChange={onOpenChange} title={t("Call details")} description={t("Information about this call.")} side="bottom" className="!h-auto !max-h-[85dvh] rounded-t-3xl">
    <div className="space-y-6 p-5 sm:p-6">
      {loading ? <p className="py-8 text-center text-sm text-[#687b89]">{t("Loading call details...")}</p> : null}
      {error ? <div className="border border-[#efc9c7] bg-[#fff5f4] p-4 text-sm text-[#a93331]">{error}</div> : null}
      {call && !loading ? <>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f6872]">{t("Call notification")}</p><h2 className="mt-2 text-xl font-bold capitalize text-[#102b3f]">{t(statusLabel(call.status))}</h2></div>
        <div className="grid gap-5 text-sm sm:grid-cols-2">
          <div className="flex gap-3"><UserRound className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">{t("Caller")}</p><p className="mt-1 text-[#687b89]">{call.caller?.name || t("Not available")} · {t(roleLabel(call.caller?.role))}</p></div></div>
          <div className="flex gap-3"><PhoneCall className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">{t("Recipient")}</p><p className="mt-1 text-[#687b89]">{call.callee?.name || t("Not available")} · {t(roleLabel(call.callee?.role))}</p></div></div>
          <div className="flex gap-3"><CalendarClock className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">{t("Started")}</p><p className="mt-1 text-[#687b89]">{formatDate(call.started_at)}</p></div></div>
          <div className="flex gap-3"><CalendarClock className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="font-semibold text-[#102b3f]">{t("Ended")}</p><p className="mt-1 text-[#687b89]">{formatDate(call.ended_at)}</p></div></div>
        </div>
        {call.duration_seconds !== null ? <p className="border-t border-[#dce5ea] pt-5 text-sm text-[#687b89]"><b className="text-[#102b3f]">{t("Duration")}:</b> {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s</p> : null}
        {call.end_reason ? <p className="border-t border-[#dce5ea] pt-5 text-sm text-[#687b89]"><b className="text-[#102b3f]">{t("End reason:")}</b> {t(call.end_reason)}</p> : null}
      </> : null}
    </div>
  </Sheet>;
}

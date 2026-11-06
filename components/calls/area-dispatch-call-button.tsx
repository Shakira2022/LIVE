"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PhoneCall } from "lucide-react";
import { useCall } from "@/components/calls/call-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

type DispatcherCandidate = { id: string; name: string; organisationName: string };
type RequestItem = { id: string; currentStatus?: string; current_status?: string; status?: string };

export function AreaDispatchCallButton({ role }: { role: "requester" | "responder" }) {
  const { call, startCallSequence } = useCall();
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [candidates, setCandidates] = useState<DispatcherCandidate[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  useEffect(() => {
    if (role !== "requester") return;
    const handleVoiceCallDispatcher = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action !== "call-dispatcher" || call.status !== "idle") return;
      setMenuOpen(false);
      void openDispatcherList();
    };
    window.addEventListener("live:requester-voice-action", handleVoiceCallDispatcher);
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceCallDispatcher);
  }, [role, call.status]);

  async function openDispatcherList() {
    setMenuOpen(false);
    setListOpen(true);
    setLoading(true);
    setError("");
    setCandidates([]);
    try {
      let activeRequestId: string | undefined;
      if (role === "requester") {
        const requestResponse = await fetch("/api/requests?scope=active&limit=100&offset=0", {
          credentials: "include",
          cache: "no-store",
        });
        const requestPayload = await requestResponse.json().catch(() => ({})) as {
          data?: { items?: RequestItem[] };
          items?: RequestItem[];
          error?: { message?: string };
        };
        if (!requestResponse.ok) throw new Error(requestPayload.error?.message || "Could not find your active emergency.");
        const activeRequest = (requestPayload.data?.items ?? requestPayload.items ?? []).find((item) => {
          const status = (item.currentStatus ?? item.current_status ?? item.status ?? "").toLowerCase().replace(/[\s-]+/g, "_");
          return ["submitted", "received", "assigned", "en_route", "arrived"].includes(status);
        });
        activeRequestId = activeRequest?.id;
      } else {
        const missionResponse = await fetch("/api/responder/mission", { credentials: "include", cache: "no-store" });
        const missionPayload = await missionResponse.json().catch(() => ({})) as {
          data?: { mission?: { request?: { id?: string } } | null };
          mission?: { request?: { id?: string } } | null;
          error?: { message?: string };
        };
        if (!missionResponse.ok) throw new Error(missionPayload.error?.message || "Could not find your active mission.");
        activeRequestId = missionPayload.data?.mission?.request?.id ?? missionPayload.mission?.request?.id;
      }
      if (!activeRequestId) throw new Error(role === "requester" ? "You need an active emergency before calling dispatch." : "You need an assigned mission before calling dispatch.");
      setRequestId(activeRequestId);

      const dispatcherResponse = await fetch(`/api/calls/dispatchers?requestId=${encodeURIComponent(activeRequestId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const dispatcherPayload = await dispatcherResponse.json().catch(() => ({})) as {
        data?: { candidates?: DispatcherCandidate[] };
        candidates?: DispatcherCandidate[];
        error?: { message?: string };
      };
      if (!dispatcherResponse.ok) throw new Error(dispatcherPayload.error?.message || "Could not load area dispatchers.");
      const nextCandidates = dispatcherPayload.data?.candidates ?? dispatcherPayload.candidates ?? [];
      setCandidates(nextCandidates);
      if (nextCandidates.length === 0) {
        setListOpen(false);
        void startCallSequence([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load area dispatchers.");
    } finally {
      setLoading(false);
    }
  }

  function callDispatcher(selected: DispatcherCandidate) {
    if (!requestId || call.status !== "idle") return;
    const selectedIndex = candidates.findIndex((candidate) => candidate.id === selected.id);
    const orderedCandidates = [...candidates.slice(selectedIndex), ...candidates.slice(0, selectedIndex)];
    setListOpen(false);
    void startCallSequence(orderedCandidates.slice(0, 3).map((candidate) => ({
      userId: candidate.id,
      name: candidate.name,
      requestId,
    })));
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`h-16 w-10 rounded-none border-x-0 border-t-0 border-b-2 bg-transparent p-0 shadow-none hover:bg-[#eef8f8] focus-visible:ring-2 focus-visible:ring-[#0f6872] ${menuOpen || listOpen ? "border-b-[#0f6872] text-[#0f6872]" : "border-b-transparent text-[#71838e] hover:text-[#0f6872]"}`}
        aria-label="Call dispatch"
        title="Call dispatch"
        aria-expanded={menuOpen}
        disabled={call.status !== "idle"}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <PhoneCall className="h-4 w-4" />
      </Button>
      {menuOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[90] min-w-40 rounded-xl border border-[#dfe7ec] bg-white p-1.5 shadow-xl" role="menu" aria-label="Call options">
          <button
            type="button"
            role="menuitem"
            disabled={call.status !== "idle"}
            onClick={() => void openDispatcherList()}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:opacity-50"
          >
            <PhoneCall className="h-4 w-4 text-[#0f6872]" />Dispatch
          </button>
        </div>
      ) : null}

      <Sheet open={listOpen} onOpenChange={setListOpen} title="Area dispatchers" description="Choose a dispatcher for your active emergency." side="center">
        <div className="max-h-[60dvh] space-y-2 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? <p className="flex items-center gap-2 py-3 text-sm text-[#617582]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading dispatchers...</p> : null}
          {error ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{error}</p> : null}
          {!loading && !error ? candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={call.status !== "idle"}
              onClick={() => callDispatcher(candidate)}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#dce5ea] px-4 text-left transition hover:border-[#9db7bf] hover:bg-[#f5f9fa] disabled:opacity-50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-[#0f6872]"><PhoneCall className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#102b3f]">{candidate.name}</span><span className="block truncate text-xs text-[#71828d]">{candidate.organisationName}</span></span>
              <span className="text-xs font-semibold text-[#0f6872]">Call</span>
            </button>
          )) : null}
        </div>
      </Sheet>
    </div>
  );
}

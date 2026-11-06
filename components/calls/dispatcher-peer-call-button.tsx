"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, PhoneCall } from "lucide-react";
import { useCall } from "@/components/calls/call-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

type DispatcherCandidate = { id: string; name: string; organisationName: string };

export function DispatcherPeerCallButton() {
  const { call, startCall } = useCall();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<DispatcherCandidate[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch("/api/calls/dispatchers", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          data?: { candidates?: DispatcherCandidate[] };
          candidates?: DispatcherCandidate[];
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(payload.error?.message || "Could not load dispatch colleagues.");
        return payload.data?.candidates ?? payload.candidates ?? [];
      })
      .then((nextCandidates) => {
        if (!cancelled) setCandidates(nextCandidates);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load dispatch colleagues.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`h-16 w-10 rounded-none border-x-0 border-t-0 border-b-2 bg-transparent p-0 shadow-none hover:bg-[#eef8f8] focus-visible:ring-2 focus-visible:ring-[#0f6872] ${open ? "border-b-[#0f6872] text-[#0f6872]" : "border-b-transparent text-[#71838e] hover:text-[#0f6872]"}`}
        aria-label="Call another dispatcher"
        title="Call another dispatcher"
        aria-expanded={open}
        disabled={call.status !== "idle"}
        onClick={() => setOpen(true)}
      >
        <PhoneCall className="h-4 w-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Call a dispatcher" description="Call an active dispatcher in your organisation." side="center">
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {loading ? <p className="flex items-center gap-2 py-3 text-sm text-[#617582]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading dispatch colleagues...</p> : null}
          {error ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{error}</p> : null}
          {!loading && !error && candidates.length === 0 ? <p className="py-3 text-sm text-[#617582]">No other active dispatchers are available in your organisation.</p> : null}
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={call.status !== "idle"}
              onClick={() => {
                setOpen(false);
                void startCall(`dispatcher:${candidate.id}`, candidate.name, {
                  targetRole: "dispatcher",
                  targetUserId: candidate.id,
                });
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#dce5ea] px-4 text-left transition hover:border-[#9db7bf] hover:bg-[#f5f9fa] disabled:opacity-50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-[#0f6872]"><PhoneCall className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#102b3f]">{candidate.name}</span><span className="block truncate text-xs text-[#71828d]">{candidate.organisationName}</span></span>
              <span className="text-xs font-semibold text-[#0f6872]">Call</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { authenticatedFetch } from "@/lib/client-api";
import { requesterText } from "@/lib/requester-ui";
import type { RequesterLanguage } from "@/lib/requester-language";

const CANCELLABLE = new Set([
  "submitted",
  "received",
  "assigned",
  "acknowledged",
  "en_route",
  "arrived",
]);

const REASONS = [
  "I no longer need help",
  "I sent this by mistake",
  "Help has already reached me",
  "Something else",
] as const;

type Phase = "idle" | "submitting" | "error" | "pending" | "cancelled";

export function CancelRequestButton({
  requestId,
  status,
  language,
  requestedAlready = false,
  onRequested,
  className,
  voiceButtonNumber,
}: {
  requestId: string;
  status: string;
  language: RequesterLanguage;
  requestedAlready?: boolean;
  onRequested?: () => void;
  className?: string;
  voiceButtonNumber?: number;
}) {
  const normalizedStatus = status.toLowerCase().replace(/[\s-]+/g, "_");
  const [open, setOpen] = useState(false);
  const [pendingInfoOpen, setPendingInfoOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>(REASONS[0]);
  const [phase, setPhase] = useState<Phase>(() => normalizedStatus === "cancelled" ? "cancelled" : requestedAlready ? "pending" : "idle");
  const [error, setError] = useState("");
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const onRequestedRef = useRef(onRequested);
  const statusCheckInFlight = useRef(false);

  const openConfirmation = useCallback(() => {
    setError("");
    setVoiceFeedback("");
    setPhase("idle");
    setOpen(true);
  }, []);

  useEffect(() => {
    onRequestedRef.current = onRequested;
  }, [onRequested]);

  useEffect(() => {
    if (normalizedStatus === "cancelled") {
      setPhase("cancelled");
    } else if (requestedAlready) {
      setPhase((current) => current === "cancelled" ? current : "pending");
    }
  }, [normalizedStatus, requestedAlready]);

  useEffect(() => {
    if (phase !== "pending") return;
    let stopped = false;

    const checkCancellationStatus = async () => {
      if (stopped || document.visibilityState === "hidden" || statusCheckInFlight.current) return;
      statusCheckInFlight.current = true;
      try {
        const response = await authenticatedFetch(`/api/requests/${encodeURIComponent(requestId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({})) as {
          data?: { currentStatus?: string; current_status?: string };
          request?: { currentStatus?: string; current_status?: string };
          currentStatus?: string;
          current_status?: string;
        };
        const request = payload.data ?? payload.request ?? payload;
        const latestStatus = String(request.currentStatus ?? request.current_status ?? "")
          .toLowerCase()
          .replace(/[\s-]+/g, "_");
        if (!stopped && latestStatus === "cancelled") {
          setPhase("cancelled");
          setError("");
          onRequestedRef.current?.();
        }
      } catch {
        // Retry at the next five second interval if the request status cannot be reached.
      } finally {
        statusCheckInFlight.current = false;
      }
    };

    const timer = window.setInterval(() => void checkCancellationStatus(), 5_000);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkCancellationStatus();
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [phase, requestId]);

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; handled?: boolean }>).detail;
      if (detail?.action !== "cancel-request" || detail.handled) return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      detail.handled = true;
      if (!CANCELLABLE.has(normalizedStatus) || phase === "pending" || phase === "cancelled" || phase === "submitting") return;
      openConfirmation();
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, [normalizedStatus, openConfirmation, phase]);

  useEffect(() => {
    if (!open) return;
    const handleVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      detail.consumed = true;
      if (!detail.isFinal || phase === "submitting") return;

      const spoken = (detail.transcript ?? "")
        .toLocaleLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const normalizedReasons = REASONS.map((option) => ({
        option,
        label: requesterText(language, option)
          .toLocaleLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      }));
      const reasonAliases: Partial<Record<(typeof REASONS)[number], string[]>> = {
        "I no longer need help": ["i dont need help", "i do not need help", "no longer need help"],
        "I sent this by mistake": ["sent by mistake", "by mistake", "wrong request"],
        "Help has already reached me": ["help arrived", "already received help", "already reached me"],
        "Something else": ["other", "other reason"],
      };
      const selectedReason = normalizedReasons.find(({ option, label }) =>
        spoken === label || spoken === option.toLocaleLowerCase() || reasonAliases[option]?.includes(spoken),
      );

      if (selectedReason) {
        setReason(selectedReason.option);
        setVoiceFeedback(`${requesterText(language, selectedReason.option)} selected. Say confirm cancellation to continue, or keep request active to go back.`);
        return;
      }

      if (["no", "nope", "cancel", "cancel that", "cancel this", "keep request active", "keep the request active", "keep it active", "go back", "do not cancel", "dont cancel", "never mind", "nevermind"].includes(spoken)) {
        setVoiceFeedback("");
        setError("");
        setOpen(false);
        return;
      }

      if (["yes", "yeah", "yep", "confirm", "confirmed", "confirm cancellation", "confirm cancel", "yes cancel", "send cancellation", "send cancellation request", "go ahead"].includes(spoken)) {
        setVoiceFeedback("");
        void confirmCancel();
        return;
      }

      setVoiceFeedback(requesterText(language, "Say one of the listed reasons, confirm cancellation, or keep the request active."));
    };

    window.addEventListener("live:requester-voice-input", handleVoiceInput);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceInput);
  }, [language, open, phase, reason]);

  if (!CANCELLABLE.has(normalizedStatus) && normalizedStatus !== "cancelled" && phase !== "cancelled") return null;

  const busy = phase === "submitting";

  async function confirmCancel() {
    setPhase("submitting");
    setError("");
    try {
      const response = await authenticatedFetch(
        `/api/requests/${encodeURIComponent(requestId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );

      const body = await response.json().catch(() => ({})) as {
        data?: { currentStatus?: string };
        error?: string | { message?: string };
        message?: string;
      };
      if (!response.ok) {
        const message = typeof body.error === "string"
          ? body.error
          : body.error?.message ?? body.message ?? "";
        throw new Error(message || `Could not send your cancellation (error ${response.status}).`);
      }

      setPhase((body.data?.currentStatus ?? "").toLowerCase() === "cancelled" ? "cancelled" : "pending");
      setOpen(false);
      onRequested?.();
    } catch (requestError) {
      setError(
        requestError instanceof TypeError
          ? requesterText(language, "Check your connection and try again.")
          : requestError instanceof Error
            ? requestError.message
            : requesterText(language, "Something went wrong. Please try again."),
      );
      setPhase("error");
    }
  }

  if (phase === "pending") {
    return (
      <div ref={rootRef} className={`min-w-0 ${className ?? ""}`}>
        <Button
          data-live-voice-number={voiceButtonNumber}
          type="button"
          variant="soft"
          className="min-h-11 w-full min-w-0 px-2 text-xs sm:text-sm"
          aria-label={requesterText(language, "Cancellation pending. Tap for details.")}
          onClick={() => setPendingInfoOpen(true)}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="truncate">{requesterText(language, "Cancelling...")}</span>
        </Button>
        <Sheet
          open={pendingInfoOpen}
          onOpenChange={setPendingInfoOpen}
          title={requesterText(language, "Cancellation pending")}
          description={requesterText(language, "Your request stays active until staff confirm.")}
          side="center"
        >
          <div className="grid gap-4 px-5 py-4 sm:px-6">
            <p className="text-sm leading-6 text-[#5f7482]">
              {requesterText(language, "Your request stays active until staff confirm. A responder may still be on the way. If you still need help or the situation is urgent, contact local emergency services.")}
            </p>
            <Button type="button" onClick={() => setPendingInfoOpen(false)}>
              {requesterText(language, "Understood")}
            </Button>
          </div>
        </Sheet>
      </div>
    );
  }

  if (phase === "cancelled") {
    return (
      <div ref={rootRef} role="status" title={requesterText(language, "Your request has been successfully cancelled.")} className={`flex min-h-11 min-w-0 items-center gap-2 px-2 text-xs font-semibold text-[#0f6872] sm:text-sm ${className ?? ""}`}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="truncate">{requesterText(language, "Request cancelled successfully")}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`h-full ${className ?? ""}`}>
      <Button
        data-live-voice-number={voiceButtonNumber}
        type="button"
        variant="danger"
        className="h-full w-full"
        onClick={openConfirmation}
      >
        {requesterText(language, "Cancel request")}
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        title={requesterText(language, "Cancel this request?")}
        description={requesterText(language, "Please confirm before we send this.")}
        side="bottom"
        dismissible={!busy}
      >
        <div className="grid gap-4 px-5 py-4 sm:px-6">
          <p className="text-sm leading-6 text-[#5f7482]">
            {requesterText(language, "If no responder is assigned, your request will be cancelled immediately. If a responder is assigned, dispatch must approve your cancellation. Responders may already be on their way, so only cancel if you are safe and no longer need help.")}
          </p>
          <p className="text-xs leading-5 text-[#71838f]">
            {requesterText(language, "With voice commands on, say a reason below, then say confirm cancellation. Say keep request active to go back.")}
          </p>

          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#798994]">
              {requesterText(language, "Why are you cancelling?")}
            </legend>
            {REASONS.map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer select-none items-center gap-3 rounded-xl border p-3 text-sm font-semibold ${reason === option ? "border-[#0f6872] bg-[#e7f3f4] text-[#0f6872]" : "border-[#dce5ea] text-[#526a78]"}`}
              >
                <input
                  type="radio"
                  name={`cancel-reason-${requestId}`}
                  value={option}
                  checked={reason === option}
                  onChange={() => setReason(option)}
                  className="h-4 w-4 accent-[#0f6872]"
                />
                {requesterText(language, option)}
              </label>
            ))}
          </fieldset>

          {voiceFeedback ? <p role="status" className="text-sm font-medium text-[#0f6872]">{voiceFeedback}</p> : null}

          {phase === "error" ? (
            <p role="alert" className="border-l-4 border-[#d53f3d] bg-[#ffefee] p-3 text-sm font-medium text-[#a93331]">
              {error}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} autoFocus>
              {requesterText(language, "Go back")}
            </Button>
            <Button type="button" variant="danger" onClick={() => void confirmCancel()} disabled={busy}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" />{requesterText(language, "Sending...")}</> : phase === "error" ? requesterText(language, "Try again") : requesterText(language, "Yes, cancel request")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

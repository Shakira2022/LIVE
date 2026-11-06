"use client";

import { Check, Loader2, Mic, MicOff, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { appendText, useSpeechToText } from "@/lib/speech/use-speech-to-text";

export type VoiceState = "idle" | "listening" | "processing" | "review" | "error";

/**
 * UI state only. useVoiceCapture() (below) drives these setters from the
 * browser's speech recognition; on its own this hook records nothing.
 */
export function useVoiceUiState() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const toListening = useCallback(() => setState("listening"), []);
  const toProcessing = useCallback(() => setState("processing"), []);
  const toReview = useCallback((text: string) => {
    setTranscript(text);
    setState("review");
  }, []);
  const toError = useCallback((message: string) => {
    setErrorMessage(message);
    setState("error");
  }, []);
  const reset = useCallback(() => {
    setTranscript("");
    setErrorMessage("");
    setState("idle");
  }, []);

  return {
    state,
    transcript,
    setTranscript,
    errorMessage,
    toListening,
    toProcessing,
    toReview,
    toError,
    reset,
  };
}

export type VoiceUi = ReturnType<typeof useVoiceUiState>;

/**
 * MERGE: connects the review-first voice UI (from the frontend handoff) to
 * LIVE's working Web Speech API hook (lib/speech/use-speech-to-text).
 *
 * Flow: tap mic -> "listening" (live words shown) -> recogniser stops ->
 * "review" with an editable transcript -> user taps Add / Discard.
 * Nothing is inserted into a field until the user accepts it.
 */
export function useVoiceCapture({ lang }: { lang?: string } = {}) {
  const voice = useVoiceUiState();
  const bufferRef = useRef("");
  const activeRef = useRef(false); // a capture the user started is in progress
  const startedRef = useRef(false); // the recogniser actually began listening
  const speech = useSpeechToText({
    lang,
    onFinal: (text) => {
      bufferRef.current = appendText(bufferRef.current, text);
    },
  });
  const { toReview, toError, toProcessing } = voice;

  // Show "turning your voice into text" while LIVE's server transcribes.
  useEffect(() => {
    if (activeRef.current && speech.processing) toProcessing();
  }, [speech.processing, toProcessing]);

  // Settle the capture once the recogniser stops (and any server
  // transcription has finished) or reports an error.
  useEffect(() => {
    if (!activeRef.current) return;
    if (speech.listening || speech.processing) {
      startedRef.current = true;
      return;
    }
    if (!speech.error && !startedRef.current) return; // start() still pending

    const heard = bufferRef.current.trim();
    activeRef.current = false;
    startedRef.current = false;
    bufferRef.current = "";
    if (heard) toReview(heard);
    else toError(speech.error || "I didn't catch that. Tap the microphone and try again.");
  }, [speech.listening, speech.processing, speech.error, toReview, toError]);

  const start = useCallback(() => {
    if (speech.supported === false) {
      toError("Voice input isn't supported in this browser. Try Chrome, Edge or Safari, or type instead.");
      return;
    }
    bufferRef.current = "";
    startedRef.current = false;
    activeRef.current = true;
    voice.toListening();
    speech.start();
  }, [speech, voice, toError]);

  const stop = useCallback(() => {
    voice.toProcessing();
    speech.stop();
  }, [speech, voice]);

  return {
    voice,
    start,
    stop,
    interim: speech.interim,
    supported: speech.supported,
    engine: speech.engine,
  };
}

export type VoiceCapture = ReturnType<typeof useVoiceCapture>;

export function MicButton({
  state,
  onStart,
  onStop,
  disabled,
  unsupported,
}: {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  /** Browser has no speech recognition (e.g. Firefox). */
  unsupported?: boolean;
}) {
  const listening = state === "listening";
  const processing = state === "processing";

  return (
    <button
      type="button"
      disabled={disabled || unsupported || processing || state === "review"}
      title={unsupported ? "Voice input isn't supported in this browser" : undefined}
      onClick={listening ? onStop : onStart}
      aria-label={listening ? "Stop recording" : processing ? "Processing voice input" : "Start voice input"}
      aria-pressed={listening}
      className={`grid h-9 w-9 place-items-center rounded-full transition disabled:opacity-50 ${
        listening
          ? "bg-[#d53f3d] text-white"
          : "bg-[#e4eaee] text-[#0f6872] hover:bg-[#0f6872] hover:text-white"
      }`}
    >
      {processing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : listening ? (
        <Square className="h-3.5 w-3.5 fill-current" />
      ) : unsupported ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

export function VoicePanel({
  voice,
  onAccept,
  onRetry,
  maxLength,
  acceptLabel = "Add to description",
  interim,
}: {
  voice: VoiceUi;
  /** Words heard so far while listening (shown live). */
  interim?: string;
  onAccept: (text: string) => void;
  onRetry: () => void;
  maxLength?: number;
  acceptLabel?: string;
}) {
  const { state } = voice;
  if (state === "idle") return null;

  if (state === "listening") {
    return (
      <div role="status" className="mt-2 flex items-center gap-2 text-sm font-medium text-[#a93331]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#d53f3d]" />
        {interim ? <span className="text-[#102b3f]">&ldquo;{interim}&rdquo;</span> : "Listening… just speak, then pause. It stops by itself."}
      </div>
    );
  }

  if (state === "processing") {
    return (
      <div role="status" className="mt-2 flex items-center gap-2 text-sm text-[#617683]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Turning your voice into text…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div role="alert" className="mt-2 border-l-4 border-[#d53f3d] bg-[#ffefee] p-3 text-sm text-[#a93331]">
        <p>{voice.errorMessage || "Voice input failed."}</p>
        <div className="mt-2 flex gap-3 text-xs font-semibold">
          <button type="button" onClick={onRetry} className="underline underline-offset-2">
            Try again
          </button>
          <button type="button" onClick={voice.reset} className="underline underline-offset-2">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // review
  return (
    <div className="mt-2 border border-[#d7e1e7] bg-[#f3f7f8] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#758793]">
        Review your transcript. You can edit it before adding.
      </p>
      <textarea
        value={voice.transcript}
        onChange={(e) =>
          voice.setTranscript(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)
        }
        rows={3}
        className="mt-2 w-full resize-none border border-[#d7e1e7] bg-white p-2 text-sm text-[#102b3f] outline-none focus:border-[#0f6872]"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        {maxLength ? (
          <span className="text-xs text-[#788a95]">
            {voice.transcript.length}/{maxLength}
          </span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={voice.reset}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#71838f] hover:text-[#102b3f]"
          >
            <X className="h-3.5 w-3.5" /> Discard
          </button>
          <button
            type="button"
            disabled={!voice.transcript.trim()}
            onClick={() => {
              onAccept(voice.transcript.trim());
              voice.reset();
            }}
            className="inline-flex items-center gap-1 rounded-md bg-[#0f6872] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
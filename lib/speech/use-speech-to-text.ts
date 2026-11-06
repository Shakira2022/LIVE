"use client";

/**
 * VOICE-TO-TEXT HOOK
 *
 * Two engines behind one interface:
 *
 * 1. "browser" - the Web Speech API (SpeechRecognition). Fast, shows words as
 *    they are spoken. BUT it streams audio to the browser vendor's cloud, and
 *    in Brave, Opera, Vivaldi, app-embedded browsers, or behind a firewall /
 *    VPN / ad-blocker that blocks that cloud, it fails with a "network" error
 *    even though the internet works. Firefox has no engine at all.
 *
 * 2. "server" - LIVE's own engine. The browser records a short clip with the
 *    microphone (MediaRecorder) and POST /api/speech/transcribe turns it into
 *    text with Gemini on LIVE's server. Works in every modern browser.
 *
 * start() uses the browser engine when it is available and has not failed in
 * this session; on a network/service failure it switches to the server
 * engine immediately, without a second tap, and remembers that for the rest
 * of the session.
 *
 * Hands-free: both engines stop by themselves when the speaker pauses. The
 * server engine watches the microphone level and stops after ~1.5 s of
 * silence (or 8 s with no speech, or 30 s at most).
 *
 * The text is never auto-submitted: final results are handed to the caller,
 * which places them where the user can review and correct them.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typings - the Web Speech API is not in TypeScript's DOM lib. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/* ---------------- session memory: browser engine failed here ---------------- */

const BROWSER_BROKEN_KEY = "live-speech-browser-engine-failed";
let browserBroken: boolean | null = null;
function isBrowserEngineBroken(): boolean {
  if (browserBroken === null) {
    try {
      browserBroken = window.sessionStorage.getItem(BROWSER_BROKEN_KEY) === "1";
    } catch {
      browserBroken = false;
    }
  }
  return browserBroken;
}
function markBrowserEngineBroken() {
  browserBroken = true;
  try {
    window.sessionStorage.setItem(BROWSER_BROKEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

/* ---------------- is LIVE's own speech service configured? ---------------- */

let serverStatus: Promise<boolean> | null = null;
function checkServerEngine(): Promise<boolean> {
  if (!serverStatus) {
    serverStatus = fetch("/api/speech/transcribe", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await response.json()) as { data?: { available?: boolean } };
        return Boolean(body?.data?.available);
      })
      .catch(() => false)
      .then((available) => {
        // Re-check later if it was unavailable (e.g. not signed in yet).
        if (!available) serverStatus = null;
        return available;
      });
  }
  return serverStatus;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it from the lock icon next to the web address, then try again.",
  "service-not-allowed": "Voice input is turned off in this browser. You can type instead.",
  "no-speech": "I didn't hear anything. Tap the microphone and try again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Voice input could not reach the speech service. Check your connection, or type instead.",
  "language-not-supported": "Voice input isn't available in this language on this browser.",
};

/** Browser-engine errors that mean "this browser's cloud engine is unusable here". */
const BROWSER_ENGINE_FAILURES = new Set(["network", "service-not-allowed", "language-not-supported"]);

const SILENCE_STOP_MS = 1500;
const NO_SPEECH_STOP_MS = 8000;
const MAX_RECORD_MS = 30000;

function pickMimeType(): string | undefined {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg"];
  for (const type of options) {
    try {
      if (window.MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function uploadForTranscription(blob: Blob): Promise<string> {
  const type = (blob.type || "audio/webm").split(";")[0];
  const send = () =>
    fetch("/api/speech/transcribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": type },
      body: blob,
    });
  let response = await send();
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => null);
    if (refreshed?.ok) response = await send();
  }
  let body: { data?: { text?: string }; error?: { message?: string } } | null = null;
  try {
    body = await response.json();
  } catch {
    /* ignore */
  }
  if (!response.ok) {
    throw new Error(body?.error?.message || "The voice service could not turn that into text. Please try again.");
  }
  return body?.data?.text?.trim() ?? "";
}

export interface SpeechToTextOptions {
  /** BCP-47 language. South African English by default. */
  lang?: string;
  /** Called with each finished phrase, ready to insert into a field. */
  onFinal: (text: string) => void;
}

export function useSpeechToText({ lang = "en-ZA", onFinal }: SpeechToTextOptions) {
  // null until mounted, so server and first client render match.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<"browser" | "server" | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRecordingRef = useRef<(() => void) | null>(null);
  const serverAvailableRef = useRef(false);
  const mountedRef = useRef(true);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    mountedRef.current = true;
    const browserOk = Boolean(recognitionCtor()) && !isBrowserEngineBroken();
    if (browserOk) setSupported(true);
    void checkServerEngine().then((available) => {
      if (!mountedRef.current) return;
      serverAvailableRef.current = available && canRecord();
      setSupported(Boolean(recognitionCtor() && !isBrowserEngineBroken()) || serverAvailableRef.current);
    });
    return () => {
      mountedRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      cleanupRecordingRef.current?.();
    };
  }, []);

  /* ------------------------------ server engine ------------------------------ */

  const startServer = useCallback(async () => {
    setEngine("server");
    setError("");
    setInterim("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setListening(false);
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? ERROR_MESSAGES["not-allowed"]
          : name === "NotFoundError"
            ? ERROR_MESSAGES["audio-capture"]
            : "The microphone could not be started. Please try again.",
      );
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      setError("This browser cannot record audio. You can type instead.");
      return;
    }
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    let heardSpeech = false;

    // Microphone level watcher for hands-free stop.
    let audioContext: AudioContext | null = null;
    let levelTimer: number | null = null;
    let maxTimer: number | null = null;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioContext = new Ctx();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const startedAt = Date.now();
        let lastLoud = Date.now();
        levelTimer = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / samples.length);
          const now = Date.now();
          if (rms > 0.035) {
            heardSpeech = true;
            lastLoud = now;
          }
          if (recorder.state !== "recording") return;
          if (heardSpeech && now - lastLoud > SILENCE_STOP_MS) recorder.stop();
          else if (!heardSpeech && now - startedAt > NO_SPEECH_STOP_MS) recorder.stop();
        }, 100);
      } else {
        heardSpeech = true; // cannot measure: let the server decide
      }
    } catch {
      heardSpeech = true;
    }
    maxTimer = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_RECORD_MS);

    const cleanup = () => {
      if (levelTimer !== null) window.clearInterval(levelTimer);
      if (maxTimer !== null) window.clearTimeout(maxTimer);
      levelTimer = null;
      maxTimer = null;
      stream.getTracks().forEach((t) => t.stop());
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
    };
    cleanupRecordingRef.current = () => {
      recorder.onstop = null;
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      cleanup();
    };

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      cleanup();
      cleanupRecordingRef.current = null;
      if (!mountedRef.current) return;
      setListening(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (!heardSpeech || blob.size < 1000) {
        setError(ERROR_MESSAGES["no-speech"]);
        return;
      }
      setProcessing(true);
      try {
        const text = await uploadForTranscription(blob);
        if (!mountedRef.current) return;
        if (text) onFinalRef.current(text.charAt(0).toUpperCase() + text.slice(1));
        else setError(ERROR_MESSAGES["no-speech"]);
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof TypeError
              ? "Voice input could not reach LIVE. Check your connection, or type instead."
              : err instanceof Error
                ? err.message
                : "Voice input stopped unexpectedly. Please try again.",
          );
        }
      } finally {
        if (mountedRef.current) setProcessing(false);
      }
    };

    try {
      recorder.start(250);
      setListening(true);
    } catch {
      cleanup();
      setListening(false);
      setError("The microphone could not be started. Please try again.");
    }
  }, []);

  /* ------------------------------ browser engine ----------------------------- */

  const startBrowser = useCallback(
    (Ctor: SpeechRecognitionCtor) => {
      recognitionRef.current?.abort();
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = false; // ends on its own when the speaker pauses
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      let switching = false;
      let gotResult = false;

      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        gotResult = true;
        setInterim(interimText.trim());
        const cleaned = finalText.trim();
        if (cleaned) onFinalRef.current(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
      };

      recognition.onerror = (event) => {
        if (event.error === "aborted") return;
        if (BROWSER_ENGINE_FAILURES.has(event.error) && !gotResult) {
          markBrowserEngineBroken();
          if (serverAvailableRef.current) {
            // Seamless fallback: keep "listening" and record with LIVE's engine.
            switching = true;
            return;
          }
        }
        setError(ERROR_MESSAGES[event.error] ?? "Voice input stopped unexpectedly. Please try again or type instead.");
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setInterim("");
        if (switching && mountedRef.current) {
          void startServer();
          return;
        }
        setListening(false);
      };

      recognitionRef.current = recognition;
      setEngine("browser");
      setError("");
      setInterim("");
      try {
        recognition.start();
        setListening(true);
      } catch {
        setListening(false);
        setError("Voice input could not start. Please try again.");
      }
    },
    [lang, startServer],
  );

  /* --------------------------------- controls -------------------------------- */

  const start = useCallback(() => {
    setError("");
    const Ctor = recognitionCtor();
    if (Ctor && !isBrowserEngineBroken()) {
      startBrowser(Ctor);
      return;
    }
    if (serverAvailableRef.current) {
      setListening(true); // immediate feedback while the microphone opens
      void startServer();
      return;
    }
    setError(
      Ctor
        ? "Voice input can't reach this browser's speech service here, and LIVE's own voice service is not set up. You can type instead."
        : "Voice input isn't supported in this browser. Try Chrome, Edge or Safari, or type instead.",
    );
  }, [startBrowser, startServer]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return {
    supported,
    listening,
    processing,
    interim,
    error,
    engine,
    start,
    stop,
    toggle,
    clearError: () => setError(""),
  };
}

export function appendText(current: string, addition: string, maxLength?: number): string {
  const base = current.trimEnd();
  const add = addition.trim();
  if (!add) return current;
  const needsStop = base && !/[.!?,;:]$/.test(base);
  let next = base ? `${base}${needsStop ? "." : ""} ${add}` : add;
  if (maxLength && next.length > maxLength) {
    next = next.slice(0, maxLength);
    const lastSpace = next.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.6) next = next.slice(0, lastSpace);
  }
  return next;
}

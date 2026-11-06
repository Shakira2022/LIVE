"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authenticatedFetch } from "@/lib/client-api";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import type { RequesterLanguage } from "@/lib/requester-language";
import { requesterText } from "@/lib/requester-ui";
import { isRequestIntakeCannotAnswer, questionsForEmergency, type RequestIntakeQuestion } from "@/lib/requester-intake";
import { useRequestIntakeAnswers } from "@/lib/use-request-intake-answers";
import { SPOKEN_SKIP_INSTRUCTION } from "@/components/requester/use-blind-voice-announcement";

type EmergencySummary = {
  id: string;
  category: string;
  note: string;
  address: string;
  status: string;
  driverAssigned: boolean;
  driverName?: string | null;
  driverStatus?: string | null;
  etaMinutes?: number | null;
};

type RecognitionResultEvent = Event & { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type RecognitionErrorEvent = Event & { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionConstructor = new () => Recognition;

const SPEECH_LANGUAGE_TAG: Record<RequesterLanguage, string> = {
  English: "en-ZA", Afrikaans: "af-ZA", isiZulu: "zu-ZA", isiXhosa: "xh-ZA", Sesotho: "st-ZA",
  Setswana: "tn-ZA", Sepedi: "nso-ZA", siSwati: "ss-ZA", Tshivenda: "ve-ZA", isiNdebele: "nr-ZA", XiTsonga: "ts-ZA",
};

function normalizeAnswer(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function BlindHomeGuidance({ emergency, language, loading, userId }: { emergency: EmergencySummary | null; language: RequesterLanguage; loading: boolean; userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [missedCount, setMissedCount] = useState(0);
  const { answers, saveAnswers } = useRequestIntakeAnswers(emergency?.id);
  const scheduleRef = useRef<() => void>(() => {});
  const timerRef = useRef<number | null>(null);
  const recognizerRef = useRef<Recognition | null>(null);
  const missedCountRef = useRef(0);
  const alertSentRef = useRef(false);
  const lastAnnouncementRef = useRef("");
  const lastEmergencyIdRef = useRef<string | null>(null);

  const questions = useMemo(
    () => emergency ? questionsForEmergency(emergency.category, emergency.note) : [],
    [emergency?.category, emergency?.note],
  );
  const nextQuestion = useMemo<RequestIntakeQuestion | null>(() => {
    if (!emergency) return null;
    return questions.find((question) => !answers[question.key]) ?? null;
  }, [answers, emergency, questions]);

  useEffect(() => {
    const sync = () => setEnabled(readRequesterPreferences(userId).blindVoiceGuidance);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("live:requester-preferences-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:requester-preferences-changed", sync);
    };
  }, [userId]);

  const speak = useCallback((text: string, after?: () => void) => {
    setMessage(text);
    if (!("speechSynthesis" in window)) {
      after?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANGUAGE_TAG[language];
    utterance.rate = 0.92;
    utterance.onend = () => after?.();
    window.speechSynthesis.speak(utterance);
  }, [language]);

  const notifyDispatcher = useCallback(async (reason: "missed_checkins" | "unsafe_response") => {
    if (!emergency || alertSentRef.current) return;
    alertSentRef.current = true;
    const response = await authenticatedFetch(`/api/requester/requests/${encodeURIComponent(emergency.id)}/check-in-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason === "missed_checkins" ? { reason, missedCheckIns: 4 } : { reason }),
    });
    if (!response.ok) {
      alertSentRef.current = false;
      setMessage(requesterText(language, "I couldn't reach dispatch. Please use the Help button or call your local emergency number."));
      return;
    }
    const payload = await response.json().catch(() => null) as { data?: { notified?: number; alreadyNotified?: boolean } } | null;
    if (!payload?.data?.notified && !payload?.data?.alreadyNotified) {
      setMessage(requesterText(language, "I could not find a dispatcher to notify. Please call your local emergency number now."));
      return;
    }
    speak(reason === "missed_checkins"
      ? requesterText(language, "I have notified dispatch that you did not answer four safety check-ins.")
      : requesterText(language, "I have notified dispatch that you may need urgent help."));
  }, [emergency, language, speak]);

  const countMissed = useCallback(() => {
    const next = missedCountRef.current + 1;
    missedCountRef.current = next;
    setMissedCount(next);
    if (next >= 4) void notifyDispatcher("missed_checkins");
    else scheduleRef.current();
  }, [notifyDispatcher]);

  const askNext = useCallback(() => {
    if (!enabled || !emergency || !microphoneReady || busy || alertSentRef.current) return;
    setBusy(true);
    if (!nextQuestion) {
      speak(requesterText(language, "Are you still there and safe? Please say yes or no."), () => listenForAnswer(null));
      return;
    }
    const question = requesterText(language, nextQuestion.question);
    const options = nextQuestion.options.map((option, index) => `${index + 1}. ${requesterText(language, option)}`);
    speak(`${question}. ${options.join(". ")}. ${requesterText(language, "Say cannot answer now if you cannot answer. Dispatch will receive that response.")} ${SPOKEN_SKIP_INSTRUCTION[language]}`, () => listenForAnswer(nextQuestion));
  }, [busy, enabled, emergency, language, microphoneReady, nextQuestion, speak]);

  const askNextRef = useRef(askNext);
  askNextRef.current = askNext;
  scheduleRef.current = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (!enabled || !emergency || !microphoneReady) return;
    timerRef.current = window.setTimeout(() => askNextRef.current(), 20_000);
  };

  function finishAnswer(question: RequestIntakeQuestion | null, transcript: string) {
    const normalizedTranscript = normalizeAnswer(transcript);
    const noAnswerPhrases = ["no", requesterText(language, "No"), "not safe", "not okay", "need help"].map(normalizeAnswer);
    const skipPhrases = ["skip", "pass", requesterText(language, "Skip this question")]
      .map(normalizeAnswer)
      .filter(Boolean);
    const isSkip = question && skipPhrases.some((phrase) => normalizedTranscript === phrase || normalizedTranscript.includes(phrase));
    if (question && emergency && isRequestIntakeCannotAnswer(transcript)) {
      saveAnswers([{
        question_key: question.key,
        question: question.question,
        answer: requesterText(language, "Cannot answer now"),
        skipped: false,
        source: "request_help",
      }]);
      missedCountRef.current = 0;
      setMissedCount(0);
      setBusy(false);
      speak(requesterText(language, "I will send dispatch that you cannot answer this question now."), () => scheduleRef.current());
      return;
    }
    if (question && emergency && isSkip) {
      saveAnswers([{
        question_key: question.key,
        question: question.question,
        answer: null,
        skipped: true,
        source: "request_help",
      }]);
      missedCountRef.current = 0;
      setMissedCount(0);
      setBusy(false);
      speak(requesterText(language, "Skipped"), () => scheduleRef.current());
      return;
    }
    if (!question && noAnswerPhrases.some((phrase) => phrase && (normalizedTranscript === phrase || normalizedTranscript.startsWith(phrase + " ")))) {
      setBusy(false);
      missedCountRef.current = 0;
      setMissedCount(0);
      void notifyDispatcher("unsafe_response");
      return;
    }
    if (question && emergency) {
      const answer = question.options.find((option) => {
        const optionText = normalizeAnswer(requesterText(language, option));
        return optionText && (normalizedTranscript === optionText || normalizedTranscript.includes(optionText));
      }) ?? transcript.trim();
      saveAnswers([{
        question_key: question.key,
        question: question.question,
        answer,
        skipped: false,
        source: "request_help",
      }]);
    }
    missedCountRef.current = 0;
    setMissedCount(0);
    setBusy(false);
    speak(requesterText(language, "Thank you. I will check in again shortly."), () => scheduleRef.current());
  }

  function listenForAnswer(question: RequestIntakeQuestion | null) {
    const speechWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setBusy(false);
      setMicrophoneReady(false);
      setMessage(requesterText(language, "Voice check-ins are not supported by this browser. Use the accessible on-screen controls or a supported browser."));
      return;
    }
    const recognition = new SpeechRecognition();
    recognizerRef.current = recognition;
    recognition.lang = SPEECH_LANGUAGE_TAG[language];
    recognition.continuous = false;
    recognition.interimResults = false;
    let settled = false;
    let heardSpeech = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      recognition.stop();
      if (!heardSpeech) {
        setBusy(false);
        speak(requesterText(language, "I did not hear an answer."), () => countMissed());
      }
    }, 10_000);
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim() ?? "";
      if (!transcript) return;
      heardSpeech = true;
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      recognizerRef.current = null;
      finishAnswer(question, transcript);
    };
    recognition.onerror = (event) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      recognizerRef.current = null;
      setBusy(false);
      if (event.error === "no-speech") {
        speak(requesterText(language, "I did not hear an answer."), () => countMissed());
      } else {
        setMicrophoneReady(false);
        setMessage(requesterText(language, "I could not understand your reply. Voice check-ins are paused until the microphone is available."));
      }
    };
    recognition.onend = () => {
      recognizerRef.current = null;
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setBusy(false);
      if (!heardSpeech) speak(requesterText(language, "I did not hear an answer."), () => countMissed());
    };
    try {
      recognition.start();
    } catch {
      window.clearTimeout(timeout);
      recognizerRef.current = null;
      setBusy(false);
      setMicrophoneReady(false);
      setMessage(requesterText(language, "I could not start the microphone. Voice check-ins are paused."));
    }
  }

  async function enableVoiceCheckIns() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(requesterText(language, "This browser cannot enable microphone check-ins."));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneReady(true);
      setBusy(false);
      speak(requesterText(language, "Voice check-ins are on. I will ask your next emergency question in 20 seconds."), () => scheduleRef.current());
    } catch {
      setMessage(requesterText(language, "Microphone access is needed for spoken check-ins. You can still use the screen reader and on-screen controls."));
    }
  }

  useEffect(() => {
    if (!enabled || loading) return;
    const identity = emergency ? JSON.stringify([emergency.id, emergency.category, emergency.address, emergency.status, emergency.driverAssigned, emergency.driverName, emergency.driverStatus, emergency.etaMinutes]) : "no-active-emergency";
    if (lastAnnouncementRef.current === identity) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setBusy(false);
    lastAnnouncementRef.current = identity;
    const greeting = !emergency
      ? requesterText(language, "You have no active emergency requests. This is a good place to start if you need help. Say help, then say Medical, Fire, or Police. You can also say request help.")
      : [
          requesterText(language, "Active emergency"), requesterText(language, emergency.category),
          requesterText(language, "Current request status"), requesterText(language, emergency.status.replace(/_/g, " ")),
          requesterText(language, "Location"), emergency.address || requesterText(language, "Location not available"),
          emergency.driverAssigned
            ? emergency.driverStatus?.toLowerCase() === "arrived" || emergency.status.toLowerCase() === "arrived"
              ? [requesterText(language, "Responder"), emergency.driverName || requesterText(language, "Assigned"), requesterText(language, "Responder has arrived")].join(". ")
              : emergency.driverStatus?.toLowerCase() === "en_route" || emergency.status.toLowerCase() === "en_route"
                ? [requesterText(language, "Responder"), emergency.driverName || requesterText(language, "Assigned"), requesterText(language, "is on the way"), requesterText(language, "Estimated arrival"), emergency.etaMinutes != null ? String(emergency.etaMinutes) + " " + requesterText(language, "minutes") : requesterText(language, "Not arrived yet")].join(". ")
                : [requesterText(language, "Responder"), emergency.driverName || requesterText(language, "Assigned"), requesterText(language, "has been assigned and is not yet marked as on the way")].join(". ")
            : requesterText(language, "Your emergency is with dispatch. A responder has not been assigned yet."),
        ].join(". ");
    setMessage(greeting);
    if ("speechSynthesis" in window) {
      window.dispatchEvent(new CustomEvent("live:blind-page-instructions", { detail: { text: greeting } }));
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(greeting);
      utterance.lang = SPEECH_LANGUAGE_TAG[language];
      utterance.rate = 0.92;
      utterance.onend = () => {
        if (emergency && microphoneReady) scheduleRef.current();
      };
      window.speechSynthesis.speak(utterance);
    }
    if (lastEmergencyIdRef.current !== emergency?.id) {
      lastEmergencyIdRef.current = emergency?.id ?? null;
      missedCountRef.current = 0;
      alertSentRef.current = false;
      setMissedCount(0);
    }
  }, [enabled, emergency, language, loading, microphoneReady]);

  useEffect(() => {
    if (enabled) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setBusy(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [enabled]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    recognizerRef.current?.stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  return null;
}

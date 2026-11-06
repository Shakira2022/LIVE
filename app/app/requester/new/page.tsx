"use client";

import {
  AnimatePresence,
  motion,
} from "framer-motion";

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Siren,
  X,
} from "lucide-react";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { SPOKEN_SKIP_INSTRUCTION, useBlindVoiceAnnouncement } from "@/components/requester/use-blind-voice-announcement";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { RequesterPageHelpButton } from "@/components/requester/requester-page-help-button";

import { Button } from "@/components/ui/button";

import {
  FieldLabel,
  Select,
  Textarea,
} from "@/components/ui/field";

import { PageHeading } from "@/components/ui/page-heading";
import { Panel } from "@/components/ui/panel";
import { PageSkeleton } from "@/components/ui/skeleton";

import { getAddressFromCoordinates } from "@/lib/location/reverseGeocode";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import { isRequestIntakeCannotAnswer, isRequestIntakeSkipCurrent, isRequestIntakeSkipRemaining, matchRequestIntakeOption, questionsForEmergency } from "@/lib/requester-intake";
import { useRequestIntakeAnswers } from "@/lib/use-request-intake-answers";

import type {
  Coordinates,
  Severity,
} from "@/lib/types";

type LocationState =
  | "idle"
  | "locating"
  | "retrying"
  | "success"
  | "failed";

type SuggestionItem = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
};

type ActiveRequestCache = {
  id: string | null;
  category?: string | null;
};

const LOCATION_ATTEMPTS = 3;
const ATTEMPT_SECONDS = 15;
const RETRY_DELAY_SECONDS = 5;
const CONFIRM_REVIEW_SECONDS = 5;
const MAX_NOTE_LENGTH = 200;
const REQUEST_DESCRIPTION_PROMPTS: Record<string, string[]> = {
  Medical: ["Person is unconscious", "Not breathing normally", "Heavy bleeding", "Chest pain", "Fell and cannot get up", "Child involved"],
  Firefighting: ["Fire or smoke", "Person trapped", "Building at risk", "Hazardous materials", "Injuries reported"],
  Police: ["Someone is in immediate danger", "Violence is happening", "Break-in in progress", "Weapon involved", "Person needs urgent protection"],
};

/* ---------------------------------------------------------------------- */
/* Middleware API response helpers                                        */
/* ---------------------------------------------------------------------- */

type RequestListItem = {
  id: string;
  category?: string;
  currentStatus?: string;
  current_status?: string;
};

type MiddlewareErrorBody = {
  ok?: boolean;
  message?: string;
  requestId?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

type CreateRequestResponse = MiddlewareErrorBody & {
  data?: {
    id?: string;
    reference?: string;
    referenceCode?: string;
  };
  request?: {
    id?: string;
    reference_code?: string;
  };
};

function getApiErrorMessage(
  payload: MiddlewareErrorBody | null,
  fallback: string
) {
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error === "object"
  ) {
    const details = payload.error.details;

    if (details) {
      const firstDetail = Object.values(details)
        .flat()
        .find(Boolean);

      if (firstDetail) {
        return firstDetail;
      }
    }

    if (payload.error.message) {
      return payload.error.message;
    }
  }

  if (payload.message) {
    return payload.message;
  }

  return fallback;
}

const MEDICAL_CATEGORIES = [
  "Medical emergency",
  "Severe Injury / Trauma",
  "Unconscious / Breathing Issues",
  "Vehicle Accident",
  "Other Medical Emergency",
];

const POLICE_CATEGORIES = [
  "Armed Robbery",
  "House Robbery",
  "Crime in Progress / Shots Fired",
  "Personal safety",
  "Suspicious Activity",
  "Other Police Emergency",
];

const FIREFIGHTING_CATEGORIES = [
  "Fire / smoke",
  "Building fire",
  "Vehicle fire",
  "Rescue from fire",
  "Other Fire Emergency",
];

function defaultCategoryForService(service: string | null) {
  if (service === "Police") return "Personal safety";
  if (service === "Firefighting") return "Fire / smoke";
  return "Medical emergency";
}

type ApiEmergencyCategory =
  | "medical"
  | "accident"
  | "fire"
  | "crime"
  | "rescue"
  | "other";

function toApiCategory(
  categoryLabel: string,
  mainCategory: string | null
): ApiEmergencyCategory {
  const label = categoryLabel.trim().toLowerCase();

  if (mainCategory === "Police") {
    return "crime";
  }

  if (
    label.includes("accident") ||
    label.includes("vehicle")
  ) {
    return "accident";
  }

  if (label.includes("fire")) {
    return "fire";
  }

  if (label.includes("rescue")) {
    return "rescue";
  }

  if (
    label.includes("medical") ||
    label.includes("injury") ||
    label.includes("trauma") ||
    label.includes("unconscious") ||
    label.includes("breathing")
  ) {
    return "medical";
  }

  return "other";
}

function wait(milliseconds: number) {
  return new Promise((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}

function ActiveRequestQuestions({
  category,
  requestId,
}: {
  category: string | null;
  requestId: string | null;
}) {
  const questions = questionsForEmergency(category ?? '');
  const { user } = useAuth();
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const { answers, saveAnswers, syncStatus } = useRequestIntakeAnswers(requestId);
  const [voiceAnswerFeedback, setVoiceAnswerFeedback] = useState("");
  const unanswered = questions.filter((item) => !answers[item.key]);
  const currentQuestion = unanswered[0];
  const questionNumber = questions.length - unanswered.length + 1;
  const announcement = !requestId
    ? null
    : currentQuestion
      ? `${requesterText(uiLanguage, "Optional details")}, ${questionNumber} of ${questions.length}. ${requesterText(uiLanguage, currentQuestion.question)}. ${requesterText(uiLanguage, "Answer")} by saying an option number or its words: ${currentQuestion.options.map((option, index) => `${index + 1}. ${requesterText(uiLanguage, option)}`).join(". ")}. ${requesterText(uiLanguage, "If you cannot answer now, say cannot answer now and dispatch will receive that response.")} ${SPOKEN_SKIP_INSTRUCTION[uiLanguage]}`
      : requesterText(uiLanguage, "Emergency questions are complete for this request.");
  useBlindVoiceAnnouncement(announcement, uiLanguage, true, user?.id);

  useEffect(() => {
    if (!requestId || !currentQuestion) return;
    const handleVoiceAnswer = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      detail.consumed = true;
      if (!detail.isFinal) return;
      const transcript = detail?.transcript?.trim();
      if (!transcript) return;
      const skipCurrent = isRequestIntakeSkipCurrent(transcript, requesterText(uiLanguage, "Skip this question"));
      if (skipCurrent) {
        setVoiceAnswerFeedback("");
        saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: null, skipped: true, source: "request_help" }]);
        return;
      }
      const skipRemaining = isRequestIntakeSkipRemaining(transcript, requesterText(uiLanguage, "Skip these questions"));
      if (skipRemaining) {
        setVoiceAnswerFeedback("");
        saveAnswers(unanswered.map((item) => ({ question_key: item.key, question: item.question, answer: null, skipped: true, source: "request_help" })));
        return;
      }
      if (isRequestIntakeCannotAnswer(transcript)) {
        setVoiceAnswerFeedback("");
        saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: requesterText(uiLanguage, "Cannot answer now"), skipped: false, source: "request_help" }]);
        return;
      }
      const answer = matchRequestIntakeOption(transcript, currentQuestion.options, (option) => requesterText(uiLanguage, option));
      if (!answer) {
        setVoiceAnswerFeedback(requesterText(uiLanguage, "I couldn't match that to an answer. Say one of the listed options."));
        return;
      }
      setVoiceAnswerFeedback("");
      saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer, skipped: false, source: "request_help" }]);
    };
    window.addEventListener("live:requester-voice-input", handleVoiceAnswer);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceAnswer);
  }, [currentQuestion, requestId, saveAnswers, uiLanguage, unanswered]);

  if (!requestId) {
    return <p className="mt-6 text-sm text-[#71838f]">{requesterText(uiLanguage, "Open the active request to add details.")}</p>;
  }

  if (!currentQuestion) {
    return (
      <div className="mt-6 px-1">
        <div className="text-center">
        <CheckCircle2 className="mx-auto h-6 w-6 text-[#0f6872]" />
        <p className="mt-2 text-sm font-semibold text-[#102b3f]">{requesterText(uiLanguage, "Emergency questions are complete for this request.")}</p>
        </div>
        <ol className="mt-4 divide-y divide-[#dce5ea] border-y border-[#dce5ea] bg-white">
          {questions.map((item, index) => {
            const saved = answers[item.key];
            return (
              <li key={item.key} className="px-3 py-4 text-left">
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-xs font-bold text-[#0f6872]">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-5 text-[#102b3f]">{requesterText(uiLanguage, item.question)}</p>
                    <p className="mt-1 text-sm leading-5 text-[#526a78]">{saved?.skipped ? requesterText(uiLanguage, "Skipped") : requesterText(uiLanguage, saved?.answer ?? "")}</p>
                    <div className="mt-3 grid gap-2">
                      {item.options.map((option) => {
                        const selected = !saved?.skipped && saved?.answer === option;
                        return <button
                          key={option}
                          data-live-voice-option
                          type="button"
                          aria-pressed={selected}
                          onClick={() => saveAnswers([{ question_key: item.key, question: item.question, answer: option, skipped: false, source: "request_help" }])}
                          className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${selected ? "border-[#0f6872] bg-[#eef8f8] text-[#0f5b67]" : "border-[#dce5ea] bg-white text-[#526a78] hover:border-[#0f6872] hover:bg-[#f4fafb]"}`}
                        >
                          <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? "border-[#0f6872]" : "border-[#9aabb5]"}`}>{selected ? <span className="h-2 w-2 rounded-full bg-[#0f6872]" /> : null}</span>
                          {requesterText(uiLanguage, option)}
                        </button>;
                      })}
                      <button
                        type="button"
                        onClick={() => saveAnswers([{ question_key: item.key, question: item.question, answer: null, skipped: true, source: "request_help" }])}
                        className="min-h-10 justify-self-start px-2 text-xs font-semibold text-[#71838f] underline underline-offset-2"
                      >{requesterText(uiLanguage, "Skip this question")}</button>
                      <button
                        type="button"
                        onClick={() => saveAnswers([{ question_key: item.key, question: item.question, answer: requesterText(uiLanguage, "Cannot answer now"), skipped: false, source: "request_help" }])}
                        className="min-h-10 justify-self-start px-2 text-xs font-semibold text-[#71838f] underline underline-offset-2"
                      >{requesterText(uiLanguage, "Cannot answer now")}</button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-center text-xs text-[#81909a]">{syncStatus === 'saving' ? requesterText(uiLanguage, 'Saving answers...') : syncStatus === 'error' ? requesterText(uiLanguage, 'Saved on this device. Database sync will retry when connected.') : requesterText(uiLanguage, 'These answers sync with LIVE AI and the dispatcher view.')}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 px-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">{requesterText(uiLanguage, "Optional details")}</p>
        <span className="text-xs font-semibold text-[#758793]">{questionNumber} / {questions.length}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentQuestion.key}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
          className="mt-4 border-y border-[#dce5ea] bg-white px-3 py-4"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0f6872] text-sm font-bold text-white">{questionNumber}</span>
            <h3 className="pt-1 font-semibold leading-6 text-[#102b3f]">{requesterText(uiLanguage, currentQuestion.question)}</h3>
          </div>
          <div className="mt-4 grid gap-2">
            {currentQuestion.options.map((option, index) => (
              <button
                data-live-voice-option
                key={option}
                type="button"
                onClick={() => { setVoiceAnswerFeedback(""); saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: option, skipped: false, source: 'request_help' }]); }}
                className="group flex w-full items-center gap-3 rounded-xl border border-[#dce5ea] bg-white px-3 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:border-[#0f6872] hover:bg-[#f4fafb] hover:text-[#0f6872]"
              >
                <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-[#9aabb5] transition group-hover:border-[#0f6872]" />
                <span>{requesterText(uiLanguage, option)}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-[#71838f]">{requesterText(uiLanguage, "With voice commands on, say an option number, its words, cannot answer now, or skip this question.")}</p>
          <button
            type="button"
            onClick={() => { setVoiceAnswerFeedback(""); saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: null, skipped: true, source: 'request_help' }]); }}
            className="mx-auto mt-4 block min-h-11 px-3 text-center text-xs font-semibold text-[#71838f] underline underline-offset-2"
          >
            {requesterText(uiLanguage, "Skip this question")}
          </button>
          <button
            type="button"
            onClick={() => { setVoiceAnswerFeedback(""); saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: requesterText(uiLanguage, "Cannot answer now"), skipped: false, source: "request_help" }]); }}
            className="mx-auto mt-2 block min-h-11 px-3 text-center text-xs font-semibold text-[#71838f] underline underline-offset-2"
          >
            {requesterText(uiLanguage, "Cannot answer now")}
          </button>
        </motion.div>
      </AnimatePresence>
      <button
        type="button"
        onClick={() => { setVoiceAnswerFeedback(""); saveAnswers(unanswered.map((item) => ({ question_key: item.key, question: item.question, answer: null, skipped: true, source: 'request_help' }))); }}
        className="mx-auto mt-3 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2"
      >
        {requesterText(uiLanguage, "Skip these questions")}
      </button>
      {voiceAnswerFeedback ? <p role="status" className="mt-2 text-center text-xs font-medium text-[#9b5b18]">{voiceAnswerFeedback}</p> : null}
      <p className="mt-2 text-center text-xs text-[#81909a]">{syncStatus === 'saving' ? requesterText(uiLanguage, 'Saving answers...') : syncStatus === 'error' ? requesterText(uiLanguage, 'Saved on this device. Database sync will retry when connected.') : requesterText(uiLanguage, 'Answers save as you go and appear in LIVE AI and the dispatcher view.')}</p>
    </div>
  );
}

function requestBrowserLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(
      window.location.hostname,
    );

    if (!window.isSecureContext && !localHost) {
      reject(new Error("Location access requires an HTTPS connection."));
      return;
    }

    let settled = false;
    let errors = 0;
    let lastError: GeolocationPositionError | null = null;

    const succeed = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      resolve(position);
    };

    const fail = (error: GeolocationPositionError) => {
      lastError = error;
      errors += 1;
      if (!settled && errors === 2) {
        settled = true;
        reject(lastError);
      }
    };

    // Mobile GPS can take a while to obtain a satellite fix. Run a quick
    // device/network lookup alongside high-accuracy GPS and use whichever
    // browser-provided location arrives first. Its accuracy is saved with the
    // request so responders can see the quality of the fix.
    navigator.geolocation.getCurrentPosition(succeed, fail, {
      enableHighAccuracy: false,
      timeout: 7_000,
      maximumAge: 30_000,
    });

    navigator.geolocation.getCurrentPosition(succeed, fail, {
      enableHighAccuracy: true,
      timeout: ATTEMPT_SECONDS * 1000,
      maximumAge: 15_000,
    });
  });
}

export default function NewRequest() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const { user } = useAuth();
  const uiLanguage = useRequesterLanguage(user?.id ?? "");

  const selectedMainCategory =
    searchParams.get("category");
  const immediateFlow = searchParams.get("flow") === "immediate";

  const categoryOptions =
    selectedMainCategory === "Police"
      ? POLICE_CATEGORIES
      : selectedMainCategory === "Firefighting"
        ? FIREFIGHTING_CATEGORIES
      : MEDICAL_CATEGORIES;

  const [step, setStep] = useState(0);

  const [category, setCategory] = useState(
    defaultCategoryForService(selectedMainCategory)
  );
  const categoryChosenByUser = useRef(false);
  const [categorySelectionCountdown, setCategorySelectionCountdown] = useState(10);
  const [categorySelectionWindowActive, setCategorySelectionWindowActive] = useState(false);

  const [severity, setSeverity] =
    useState<Severity>("High");

  const [voiceFocusedField, setVoiceFocusedField] = useState<"service" | "category" | "priority" | null>(null);

  const [note, setNote] = useState("");

  const toggleDescriptionPrompt = (prompt: string) => {
    const existing = note.split(/(?<=[.!?])\s+/).filter((part) => part.trim());
    const found = existing.some((part) => part.replace(/[.!?]+$/, "").toLocaleLowerCase() === prompt.toLocaleLowerCase());
    const next = found
      ? existing.filter((part) => part.replace(/[.!?]+$/, "").toLocaleLowerCase() !== prompt.toLocaleLowerCase()).join(" ")
      : [...existing, `${prompt}.`].join(" ");
    setNote(next.slice(0, MAX_NOTE_LENGTH));
  };


  const [coordinates, setCoordinates] =
    useState<Coordinates | null>(null);

  const [accuracy, setAccuracy] =
    useState<number | undefined>();

  // Retained only for compatibility with the legacy failure branch below;
  // the GPS-only flow never exposes or uses manual address entry.
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);

  const focusVoiceField = useCallback((field: "service" | "category" | "priority") => {
    setVoiceFocusedField(field);
    window.requestAnimationFrame(() => {
      const controlId = field === "service"
        ? "request-emergency-service"
        : field === "category"
          ? "request-emergency-category"
          : "request-emergency-priority";
      document.getElementById(controlId)?.focus();
    });
  }, []);

  const setEmergencyService = useCallback((categoryGroup: "Medical" | "Firefighting" | "Police") => {
    categoryChosenByUser.current = false;
    setCategory(defaultCategoryForService(categoryGroup));
    focusVoiceField("category");
    const params = new URLSearchParams(window.location.search);
    params.set("category", categoryGroup);
    if (params.get("flow") !== "immediate") params.set("flow", "details");
    router.replace(`/app/requester/new?${params.toString()}`);
  }, [focusVoiceField, router]);

  const [address, setAddress] =
    useState("");

  const [locationState, setLocationState] =
    useState<LocationState>("idle");

  const [attempt, setAttempt] =
    useState(0);

  const [
    attemptCountdown,
    setAttemptCountdown,
  ] = useState(ATTEMPT_SECONDS);

  const [
    locationMessage,
    setLocationMessage,
  ] = useState("");

  const [
    confirmCountdown,
    setConfirmCountdown,
  ] = useState(CONFIRM_REVIEW_SECONDS);

  const [error, setError] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  const initialActiveRequest = user?.id
    ? readCached<ActiveRequestCache>(
        `requester-active-request:${user.id}`,
      )
    : null;

  const [
    hasActiveRequest,
    setHasActiveRequest,
  ] = useState(() => Boolean(initialActiveRequest?.id));

  const [
    activeRequestId,
    setActiveRequestId,
  ] = useState<string | null>(() => initialActiveRequest?.id ?? null);
  const [activeRequestCategory, setActiveRequestCategory] = useState<string | null>(() => initialActiveRequest?.category ?? null);

  const [activeRequestReady, setActiveRequestReady] =
    useState(() => Boolean(initialActiveRequest));

  const locationRunRef =
    useRef(0);

  const countdownTimerRef =
    useRef<number | null>(null);

  const autoSubmitRef =
    useRef(false);


  /*
   * One stable idempotency key is used for this logical submission.
   * If the browser retries after a network failure, the middleware
   * can return the existing request instead of creating a duplicate.
   */
  const idempotencyKeyRef =
    useRef<string | null>(null);

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; category?: string }>).detail;
      if (detail?.action !== "set-emergency-category") return;
      if (!hasActiveRequest && (detail.category === "Medical" || detail.category === "Firefighting" || detail.category === "Police")) {
        setEmergencyService(detail.category);
      }
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, [hasActiveRequest, setEmergencyService]);

  useEffect(() => {
    if (step !== 0 || hasActiveRequest) return;
    const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const handleVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      const spoken = normalize(detail.transcript ?? "");
      if (!spoken) return;

      if (/^(?:emergency )?(?:service|service type)$/.test(spoken)) {
        detail.consumed = true;
        if (detail.isFinal) focusVoiceField("service");
        return;
      }
      if (/^(?:emergency )?category$/.test(spoken)) {
        detail.consumed = true;
        if (detail.isFinal) focusVoiceField("category");
        return;
      }
      if (/^(?:request )?priority$/.test(spoken)) {
        detail.consumed = true;
        if (detail.isFinal) focusVoiceField("priority");
        return;
      }

      const optionMatch = matchRequestIntakeOption(
        detail.transcript ?? "",
        categoryOptions,
        (option) => requesterText(uiLanguage, option),
      );
      if (optionMatch) {
        detail.consumed = true;
        if (detail.isFinal) {
          categoryChosenByUser.current = true;
          setCategory(optionMatch);
          focusVoiceField("category");
        }
        return;
      }

      const service = /\b(?:fire|firefighting|firefighter|fire fighter|fire department|smoke|burning|flames)\b/.test(spoken)
        ? "Firefighting"
        : /\b(?:police|law enforcement|police department|personal safety|unsafe|being followed)\b/.test(spoken)
          ? "Police"
          : /\b(?:medical|medicine|ambulance|doctor|health|injured|injury|not breathing|unconscious)\b/.test(spoken)
            ? "Medical"
            : null;
      if (service) {
        detail.consumed = true;
        if (detail.isFinal) setEmergencyService(service);
        return;
      }

      const priorityMatch = spoken.match(/\b(critical|high|moderate|medium)\b/);
      if (priorityMatch) {
        detail.consumed = true;
        if (detail.isFinal) {
          setSeverity(priorityMatch[1] === "medium" ? "Moderate" : priorityMatch[1] as Severity);
          focusVoiceField("priority");
        }
        return;
      }

      const targetField = voiceFocusedField ?? (/^priority\b/.test(spoken) ? "priority" : "category");
      const normalizedOptions = targetField === "priority"
        ? (["Critical", "High", "Moderate"] as const)
        : targetField === "service"
          ? (["Medical", "Firefighting", "Police"] as const)
          : categoryOptions;
      const currentValue = targetField === "priority" ? severity : targetField === "service" ? (selectedMainCategory ?? "Medical") : category;
      const currentIndex = normalizedOptions.findIndex((option) => option === currentValue);
      const isNext = /^(?:next|next option|next choice|move down|move to next option)$/.test(spoken);
      const isPrevious = /^(?:previous|previous option|previous choice|last option|move up|move to previous option)$/.test(spoken);
      const optionSpeech = spoken.replace(/^(?:priority|emergency category|service(?: type)?) /, "");
      const numberedOption = optionSpeech.match(/^(?:(?:select|choose|pick|click|press|open) )?(?:(?:button|option|choice) )?(?:number )?(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth|[1-9]|10)$/);
      if (isNext || isPrevious || numberedOption) {
        detail.consumed = true;
        const words: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10 };
        const index = numberedOption
          ? (words[numberedOption[1]] ?? Number(numberedOption[1])) - 1
          : isNext
            ? (currentIndex + 1 + normalizedOptions.length) % normalizedOptions.length
            : (currentIndex - 1 + normalizedOptions.length) % normalizedOptions.length;
        const selected = normalizedOptions[index];
        if (!selected) return;
        if (detail.isFinal) {
          if (targetField === "priority") {
            setSeverity(selected as Severity);
            focusVoiceField("priority");
          } else if (targetField === "service") {
            setEmergencyService(selected as "Medical" | "Firefighting" | "Police");
          } else {
            categoryChosenByUser.current = true;
            setCategory(selected);
            focusVoiceField("category");
          }
        }
      }
    };
    window.addEventListener("live:requester-voice-input", handleVoiceInput);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceInput);
  }, [category, categoryOptions, focusVoiceField, hasActiveRequest, searchParams, selectedMainCategory, severity, setEmergencyService, step, uiLanguage, voiceFocusedField]);

  /* ---------------------------------------------------------------------- */
  /* Clear location timer                                                   */
  /* ---------------------------------------------------------------------- */

  function clearAttemptTimer() {
    if (
      countdownTimerRef.current !== null
    ) {
      window.clearInterval(
        countdownTimerRef.current
      );

      countdownTimerRef.current = null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Location attempt                                                       */
  /* ---------------------------------------------------------------------- */

  const runLocationAttempt = useCallback(
    async (
      attemptNumber: number,
      runId: number
    ) => {
      if (
        runId !== locationRunRef.current
      ) {
        return;
      }

      clearAttemptTimer();

      setAttempt(attemptNumber);

      setAttemptCountdown(
        ATTEMPT_SECONDS
      );

      setLocationState("locating");

      setLocationMessage(
        requesterText(uiLanguage, "Attempt {attempt} of {total}", { attempt: attemptNumber, total: LOCATION_ATTEMPTS })
      );

      setError("");

      const startedAt = Date.now();

      countdownTimerRef.current =
        window.setInterval(() => {
          setAttemptCountdown((current) =>
            Math.max(0, current - 1)
          );
        }, 1000);

      try {
        const position =
          await requestBrowserLocation();

        const minimumVisibleTime = 2000;

        const elapsed =
          Date.now() - startedAt;

        if (
          elapsed < minimumVisibleTime
        ) {
          await wait(
            minimumVisibleTime - elapsed
          );
        }

        clearAttemptTimer();

        if (
          runId !==
          locationRunRef.current
        ) {
          return;
        }

        const nextCoordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setCoordinates(
          nextCoordinates
        );

        setAccuracy(
          position.coords.accuracy
        );

        // Confirm GPS immediately. Reverse geocoding is supplementary and
        // must not delay the user's ability to continue the emergency flow.
        setAddress(
          `${nextCoordinates.lat.toFixed(6)}, ${nextCoordinates.lng.toFixed(6)}`
        );

        void getAddressFromCoordinates(
          nextCoordinates.lat,
          nextCoordinates.lng
        )
          .then((realAddress) => {
            if (runId === locationRunRef.current) {
              setAddress(realAddress);
            }
          })
          .catch((error) => {
            console.error(
              "Failed to reverse geocode location:",
              error
            );
          });

        setAttemptCountdown(0);

        setLocationState("success");

        setLocationMessage(
          "Location confirmed"
        );

        await wait(1600);

        if (
          runId ===
          locationRunRef.current
        ) {
          setStep(2);
        }
      } catch (locationError) {
        const elapsed =
          Date.now() - startedAt;

        const remainingAttemptTime =
          Math.max(
            0,
            ATTEMPT_SECONDS * 1000 -
              elapsed
          );

        if (
          remainingAttemptTime > 0
        ) {
          await wait(
            remainingAttemptTime
          );
        }

        clearAttemptTimer();

        setAttemptCountdown(0);

        if (
          runId !==
          locationRunRef.current
        ) {
          return;
        }

        if (
          attemptNumber <
          LOCATION_ATTEMPTS
        ) {
          setLocationState(
            "retrying"
          );

          setLocationMessage(
            requesterText(uiLanguage, "Attempt {attempt} was unsuccessful", { attempt: attemptNumber })
          );

          await wait(1100);

          if (
            runId ===
            locationRunRef.current
          ) {
            await runLocationAttempt(
              attemptNumber + 1,
              runId
            );
          }

          return;
        }

        const locationErrorCode =
          typeof locationError ===
            "object" &&
          locationError !== null &&
          "code" in locationError
            ? Number(
                (
                  locationError as {
                    code?: unknown;
                  }
                ).code
              )
            : undefined;

        if (locationErrorCode === 1) {
          setLocationState("failed");
          setLocationMessage(
            "Location permission is blocked. Allow precise location in your browser settings, then reopen this request.",
          );
          return;
        }

        const message =
          "LIVE could not confirm your location after three attempts. Retrying in 5 seconds.";

        setLocationState("retrying");
        setLocationMessage(message);

        await wait(RETRY_DELAY_SECONDS * 1000);

        if (runId === locationRunRef.current) {
          await runLocationAttempt(1, runId);
        }
      }
    },
    [uiLanguage]
  );

  /* ---------------------------------------------------------------------- */
  /* Start location sequence                                                */
  /* ---------------------------------------------------------------------- */

  const startLocationSequence =
    useCallback(() => {
      const runId =
        locationRunRef.current + 1;

      locationRunRef.current =
        runId;

      setCoordinates(null);
      setAccuracy(undefined);
      setAddress("");
      setError("");

      void runLocationAttempt(
        1,
        runId
      );
    }, [runLocationAttempt]);

  /* ---------------------------------------------------------------------- */
  /* Start location when step 1 opens                                       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (step !== 1) {
      return;
    }

    startLocationSequence();

    return () => {
      locationRunRef.current += 1;
      clearAttemptTimer();
    };
  }, [
    step,
    startLocationSequence,
  ]);

  /* Give the requester a visible category-choice window on express flows.
   * Only after ten seconds do we use the service default and continue. */
  useEffect(() => {
    if (!selectedMainCategory || step !== 0) {
      setCategorySelectionWindowActive(false);
      return;
    }
    const preferences = readRequesterPreferences(user?.id);
    const shouldAutoAdvance = immediateFlow ||
      (searchParams.get("flow") !== "details" && preferences.skipIncidentDetails);
    setCategorySelectionWindowActive(shouldAutoAdvance);
    setCategorySelectionCountdown(10);

    const countdownInterval = window.setInterval(() => {
      setCategorySelectionCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    const fallbackTimeout = window.setTimeout(() => {
      if (!categoryChosenByUser.current) {
        setCategory(defaultCategoryForService(selectedMainCategory));
      }
      setCategorySelectionWindowActive(false);
      if (shouldAutoAdvance) setStep(1);
    }, 10_000);

    return () => {
      window.clearInterval(countdownInterval);
      window.clearTimeout(fallbackTimeout);
    };
  }, [immediateFlow, searchParams, selectedMainCategory, step, user?.id]);

  /* ---------------------------------------------------------------------- */
  /* Check for an existing active request                                   */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let cancelled = false;

    const cacheKey = `requester-active-request:${user.id}`;
    const cached = readFreshCache<ActiveRequestCache>(cacheKey);
    if (cached) {
      setHasActiveRequest(Boolean(cached.id));
      setActiveRequestId(cached.id);
      setActiveRequestCategory(cached.category ?? null);
      return () => {
        cancelled = true;
      };
    }

    async function checkActiveRequest() {
      try {
        /*
         * The middleware identifies the requester from the signed JWT.
         * Do not send requesterId/phone as ownership selectors.
         */
        const response = await fetch(
          "/api/requests?limit=50&offset=0",
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        );

        let payload:
          | (MiddlewareErrorBody & {
              data?: {
                items?: RequestListItem[];
              };
              items?: RequestListItem[];
              requests?: RequestListItem[];
            })
          | null = null;

        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok) {
          console.error(
            "Failed to check active request:",
            getApiErrorMessage(
              payload,
              "Unable to load existing requests."
            )
          );
          return;
        }

        const requests =
          payload?.data?.items ??
          payload?.items ??
          payload?.requests ??
          [];

        const active = requests.find(
          (request) => {
            const status =
              request.currentStatus ??
              request.current_status ??
              "";

            return [
              "submitted",
              "received",
              "assigned",
              "acknowledged",
              "en_route",
              "arrived",
            ].includes(status);
          }
        );

        if (cancelled) {
          return;
        }

        if (active) {
          setHasActiveRequest(true);
          setActiveRequestId(active.id);
          setActiveRequestCategory(active.category ?? null);
          writeFreshCache(cacheKey, { id: active.id, category: active.category ?? null }, 5 * 60_000);
        } else {
          setHasActiveRequest(false);
          setActiveRequestId(null);
          setActiveRequestCategory(null);
          writeFreshCache(cacheKey, { id: null }, 30_000);
        }
      } catch (error) {
        console.error(
          "Failed to check active request:",
          error
        );
      } finally {
        if (!cancelled) {
          setActiveRequestReady(true);
        }
      }
    }

    void checkActiveRequest();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /* ---------------------------------------------------------------------- */
  /* Submit request                                                         */
  /* ---------------------------------------------------------------------- */

  const submit = useCallback(
    async () => {
      if (
        submitting ||
        autoSubmitRef.current
      ) {
        return;
      }

      if (!user) {
        setError(
          "You must be logged in to submit an emergency request."
        );
        return;
      }

      if (hasActiveRequest) {
        setError(
          "You already have an active emergency request. Open it before requesting additional help.",
        );
        return;
      }

      if (!coordinates) {
        setError(
          "Your location has not been confirmed."
        );
        return;
      }

      if (!user.id) {
        setError(
          "Your account could not be identified."
        );
        return;
      }

      if (!user.phone?.trim()) {
        setError(
          "Your account does not have a callback phone number. Add one to your profile before submitting."
        );
        return;
      }

      autoSubmitRef.current = true;
      setSubmitting(true);
      setError("");

      /*
       * Keep the same key if a submission must be retried. The middleware
       * request service uses this value to prevent duplicate emergencies.
       */
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          crypto.randomUUID();
      }

      const capturedAt =
        new Date().toISOString();

      try {
        /*
         * IMPORTANT:
         *
         * This payload matches the middleware createRequest contract.
         * Location fields are FLAT; there is no nested `location` object.
         * requesterId is intentionally omitted because ctx.user comes from JWT.
         */
        const response = await fetch(
          "/api/requests",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials: "include",

            body: JSON.stringify({
              /*
               * Keep the GUI labels unchanged, but convert them to the
               * canonical middleware enum before sending to the API.
               */
              category: toApiCategory(
                category,
                selectedMainCategory
              ),

              /*
               * The UI keeps Title Case for display, while the database/API
               * status enums use lowercase values.
               */
              severity:
                String(severity).toLowerCase(),

              note:
                note.trim() ||
                "No additional note provided.",

              callbackNumber:
                user.phone.trim(),

              idempotencyKey:
                idempotencyKeyRef.current,

              locationMethod: "gps",

              latitude:
                coordinates.lat,

              longitude:
                coordinates.lng,

              accuracyMeters:
                accuracy ?? null,

              addressText:
                address ||
                "Current device location",

              capturedAt,
            }),
          }
        );

        let data:
          | CreateRequestResponse
          | null = null;

        try {
          data =
            (await response.json()) as
              CreateRequestResponse;
        } catch {
          data = null;
        }

        console.log(
          "CREATE REQUEST STATUS:",
          response.status
        );

        console.log(
          "CREATE REQUEST RESPONSE:",
          data
        );

        if (!response.ok) {
          throw new Error(
            getApiErrorMessage(
              data,
              "Failed to create emergency request."
            )
          );
        }

        /*
         * createHandler() wraps successful middleware responses as:
         *
         * {
         *   ok: true,
         *   data: { ...request },
         *   requestId: "..."
         * }
         *
         * The fallback to data.request keeps this page compatible with the
         * older backend response while the rest of the project is migrated.
         */
        const createdRequestId =
          data?.data?.id ??
          data?.request?.id;

        if (!createdRequestId) {
          throw new Error(
            "The emergency request was created, but the server did not return its request ID."
          );
        }

        router.replace(
          `/app/requester/track/${createdRequestId}`
        );
      } catch (error) {
        console.error(
          "Failed to submit emergency request:",
          error
        );

        setSubmitting(false);

        /*
         * Keep this true after a failed automatic submission.
         * confirmCountdown is already 0, so setting this back to false would
         * make the auto-submit effect immediately POST again in a loop.
         *
         * It is reset when the user leaves/re-enters the confirmation step.
         */
        autoSubmitRef.current =
          true;

        setError(
          error instanceof Error
            ? error.message
            : "Failed to submit emergency request."
        );
      }
    },
    [
      accuracy,
      address,
      category,
      coordinates,
      hasActiveRequest,
      note,
      router,
      selectedMainCategory,
      severity,
      submitting,
      user,
    ]
  );

  /* ---------------------------------------------------------------------- */
  /* Confirmation countdown                                                 */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (step !== 2) {
      autoSubmitRef.current =
        false;

      setSubmitting(false);

      return;
    }

    autoSubmitRef.current =
      false;

    setConfirmCountdown(
      CONFIRM_REVIEW_SECONDS
    );

    const timer =
      window.setInterval(() => {
        setConfirmCountdown(
          (current) => {
            if (current <= 1) {
              window.clearInterval(
                timer
              );

              return 0;
            }

            return current - 1;
          }
        );
      }, 1000);

    return () =>
      window.clearInterval(timer);
  }, [step]);

  /* ---------------------------------------------------------------------- */
  /* Automatically submit                                                   */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (
      step !== 2 ||
      confirmCountdown !== 0 ||
      autoSubmitRef.current
    ) {
      return;
    }

    const timer =
      window.setTimeout(() => {
        void submit();
      }, 450);

    return () =>
      window.clearTimeout(timer);
  }, [
    confirmCountdown,
    step,
    submit,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */

  if (!user || !activeRequestReady) {
    return <PageSkeleton map />;
  }

  const steps = [
    "Details",
    "Location",
    "Confirm",
  ];

  const locationBusy =
    locationState === "idle" ||
    locationState === "locating" ||
    locationState === "retrying";

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        title={requesterText(uiLanguage, "Request assistance")}
        description={
          <>
            <span className="md:hidden">
              {requesterText(uiLanguage, "Complete only the essential incident information.")}
            </span>
            <span className="hidden md:inline">
              {requesterText(uiLanguage, "Complete only the essential incident information. Contact details are taken from your profile.")}
            </span>
          </>
        }
        action={<RequesterPageHelpButton page="request" language={uiLanguage} />}
      />

      {hasActiveRequest ? (
        <div className="grid gap-4">
          <Panel
            mobileCard={false}
            className="-mx-5 border-x-0 border-[#f0c8c7] bg-[#fff7f6] p-5 md:mx-0 md:rounded-[22px] md:border-x"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <Siren className="h-5 w-5 shrink-0 text-[#d53f3d]" />
                <div className="min-w-0">
                  <h2 className="font-semibold">
                    {requesterText(uiLanguage, "An active request already exists")}
                  </h2>
                  <p className="mt-1 text-sm text-[#6d6060]">
                    {requesterText(uiLanguage, "Open your active request instead of creating a duplicate request.")}
                  </p>
                </div>
              </div>
              {activeRequestId ? (
                <Button
                  variant="danger"
                  className="shrink-0 self-end sm:self-start"
                  onClick={() => router.push(`/app/requester/track/${activeRequestId}`)}
                >
                  {requesterText(uiLanguage, "Open active request")}
                </Button>
              ) : null}
            </div>
          </Panel>
          <ActiveRequestQuestions
            category={activeRequestCategory ?? selectedMainCategory}
            requestId={activeRequestId}
          />
        </div>
      ) : (
        <>
          <div className="relative grid grid-cols-3 items-start px-2 sm:px-5">
            <span className="absolute left-[16.67%] right-[16.67%] top-4 h-px bg-[#d7e1e7]" />

            {steps.map(
              (label, index) => (
                <div
                  key={label}
                  className="relative z-10 flex flex-col items-center"
                >
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${
                      index <= step
                        ? "bg-[#0f6872] text-white"
                        : "bg-[#e4eaee] text-[#788a95]"
                    }`}
                  >
                    {index < step ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      index + 1
                    )}
                  </span>

                  <span
                    className={`mt-2 hidden text-center text-xs font-semibold sm:block ${
                      index <= step
                        ? "text-[#102b3f]"
                        : "text-[#8a9aa5]"
                    }`}
                  >
                    {requesterText(uiLanguage, label)}
                  </span>
                </div>
              )
            )}
          </div>

          <Panel
            mobileCard={false}
          data-live-voice-form-focus={step === 0 && voiceFocusedField ? "true" : undefined}
          className="-mx-5 border-x-0 border-b-0 bg-transparent shadow-none md:mx-0 md:border-x md:bg-white"
          >
            <div data-live-voice-focus-hint className="hidden shrink-0 items-center gap-2 border-b border-[#f1dfa9] bg-[#fff8df] px-5 py-2 text-xs font-semibold text-[#705400] md:mx-0">
              {requesterText(uiLanguage, "Voice control is active. Say a listed answer or say the option number or category name. Priority already has a default.")}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{
                  opacity: 0,
                  x: 12,
                }}
                animate={{
                  opacity: 1,
                  x: 0,
                }}
                exit={{
                  opacity: 0,
                  x: -12,
                }}
                transition={{
                  duration: 0.2,
                }}
                className="px-5 py-4 md:p-6"
              >
                {/* STEP 0 - DETAILS */}

                {step === 0 ? (
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <label>
                        <FieldLabel>
                          {requesterText(uiLanguage, "Emergency service")}
                        </FieldLabel>

                        <Select
                          id="request-emergency-service"
                          data-live-voice-option-focused={voiceFocusedField === "service" ? "true" : undefined}
                          value={selectedMainCategory ?? "Medical"}
                          onFocus={() => setVoiceFocusedField("service")}
                          onChange={(event) => {
                            if (event.target.value === "Medical" || event.target.value === "Firefighting" || event.target.value === "Police") {
                              setEmergencyService(event.target.value);
                            }
                          }}
                        >
                          <option value="Medical">{requesterText(uiLanguage, "Medical")}</option>
                          <option value="Firefighting">{requesterText(uiLanguage, "Fire")}</option>
                          <option value="Police">{requesterText(uiLanguage, "Police")}</option>
                        </Select>
                      </label>

                      <label>
                        <FieldLabel>
                          {requesterText(uiLanguage, "Emergency category")}
                        </FieldLabel>

                        <Select
                          id="request-emergency-category"
                          data-live-voice-option-focused={voiceFocusedField === "category" ? "true" : undefined}
                          value={category}
                          onFocus={() => setVoiceFocusedField("category")}
                          onChange={(event) => { categoryChosenByUser.current = true; setCategory(event.target.value); setVoiceFocusedField("category"); }}
                        >
                          {categoryOptions.map(
                            (option) => (
                              <option
                                key={option}
                                value={option}
                              >
                                {requesterText(uiLanguage, option)}
                              </option>
                            )
                          )}
                        </Select>
                      </label>

                      <label>
                        <FieldLabel>
                          {requesterText(uiLanguage, "Priority")}
                        </FieldLabel>

                        <Select
                          id="request-emergency-priority"
                          data-live-voice-option-focused={voiceFocusedField === "priority" ? "true" : undefined}
                          value={severity}
                          onFocus={() => setVoiceFocusedField("priority")}
                          onChange={(event) => { setSeverity(event.target.value as Severity); setVoiceFocusedField("priority"); }}
                        >
                          <option value="Critical">
                            {requesterText(uiLanguage, "Critical")}
                          </option>

                          <option value="High">
                            {requesterText(uiLanguage, "High")}
                          </option>

                          <option value="Moderate">
                            {requesterText(uiLanguage, "Moderate")}
                          </option>
                        </Select>
                      </label>
                    </div>

                    {categorySelectionWindowActive ? (
                      <p role="status" aria-live="polite" className="rounded-lg border border-[#dce8ed] bg-[#f3f8fa] px-3 py-2 text-sm text-[#31586b]">
                        {categoryChosenByUser.current
                          ? requesterText(uiLanguage, "Category {category} selected. Continue now, or this screen will continue in {seconds} seconds.", { category: requesterText(uiLanguage, category), seconds: categorySelectionCountdown })
                          : requesterText(uiLanguage, "Choose an emergency category within {seconds} seconds. If you do not choose one, {category} will be used and the request will continue.", { category: requesterText(uiLanguage, defaultCategoryForService(selectedMainCategory)), seconds: categorySelectionCountdown })}
                      </p>
                    ) : null}

                    <label>
                      <div className="flex items-center justify-between">
                        <FieldLabel>
                          {requesterText(uiLanguage, "Short description")}
                        </FieldLabel>
                        <div className="flex items-center gap-3">
                          {note ? <button type="button" onClick={() => setNote("")} className="inline-flex items-center gap-1 text-xs font-medium text-[#617683] hover:text-[#a93331]" aria-label={requesterText(uiLanguage, "Clear description")}><X className="h-3.5 w-3.5" /> {requesterText(uiLanguage, "Clear")}</button> : null}
                          <span className="text-xs text-[#788a95]">{note.length}/{MAX_NOTE_LENGTH}</span>
                        </div>
                      </div>

                      <Textarea
                        value={note}
                        onChange={(event) =>
                          setNote(
                            event.target.value.slice(
                              0,
                              MAX_NOTE_LENGTH
                            )
                          )
                        }
                        placeholder={requesterText(uiLanguage, "What happened and what help is needed?")}
                      />
                    </label>

                    <div className="mt-3">
                      <p className="mb-2 text-xs font-medium text-[#788a95]">{requesterText(uiLanguage, "Tap what applies")}</p>
                      <div className="flex flex-wrap gap-2">
                        {(REQUEST_DESCRIPTION_PROMPTS[selectedMainCategory ?? "Medical"] ?? REQUEST_DESCRIPTION_PROMPTS.Medical).map((prompt) => {
                          const displayedPrompt = requesterText(uiLanguage, prompt);
                          const selected = note.toLocaleLowerCase().includes(displayedPrompt.toLocaleLowerCase());
                          return <button key={prompt} type="button" aria-pressed={selected} onClick={() => toggleDescriptionPrompt(displayedPrompt)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${selected ? "border-[#0f6872] bg-[#0f6872] text-white" : "border-[#d7e1e7] bg-white text-[#31586b] hover:border-[#0f6872]"}`}><span aria-hidden="true">{selected ? "✓" : "+"}</span>{displayedPrompt}</button>;
                        })}
                      </div>
                    </div>

                  <div className="hidden items-start gap-3 bg-[#f3f7f8] px-4 py-3.5 text-sm text-[#5f7480] md:flex">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1f845b]" />
                    <p className="leading-6">
                      {requesterText(uiLanguage, "Your saved callback number is attached to this request: {phone}", { phone: user.phone || requesterText(uiLanguage, "your registered contact number") })}
                    </p>
                  </div>

                  </div>
                ) : step === 1 ? (
                  /* STEP 1 - LOCATION */

                  <div className="grid gap-3 lg:grid-cols-[0.72fr_1.28fr] lg:gap-5">
                    <div className="relative -mx-5 overflow-hidden md:mx-0 lg:order-2">
                      <LiveResponseMap
                        className="h-[220px] min-h-[220px] rounded-none md:h-[360px] md:min-h-[360px] md:rounded-[20px] lg:h-[56dvh] lg:min-h-[430px]"
                        previewLocation={
                          coordinates &&
                          locationState ===
                            "success"
                            ? {
                                ...coordinates,
                                address,
                                accuracy,
                              }
                            : undefined
                        }
                      />

                      {locationBusy ? (
                        <div className="absolute inset-0 z-30 grid place-items-center bg-[#edf3f6]/94 px-5 text-center backdrop-blur-sm">
                          <div>
                            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-[#0f6872] shadow-sm">
                              <Loader2 className="h-7 w-7 animate-spin" />
                            </span>

                            <h2 className="mt-4 text-base font-semibold text-[#102b3f]">
                              {requesterText(uiLanguage, "Locating your device")}
                            </h2>

                            <p className="mt-2 text-sm text-[#617683]">
                              {locationState ===
                              "retrying"
                                ? requesterText(uiLanguage, locationMessage)
                                : `${requesterText(uiLanguage, locationMessage)} · ${attemptCountdown}s`}
                            </p>

                          </div>
                        </div>
                      ) : null}

                      {locationState === "failed" ? (
                        <div className="absolute inset-0 z-30 grid place-items-center bg-[#fff6f5]/96 px-5 text-center backdrop-blur-sm">
                          <div className="max-w-sm">
                            <MapPin className="mx-auto h-7 w-7 text-[#c73937]" />
                            <h2 className="mt-3 font-semibold text-[#102b3f]">
                              {requesterText(uiLanguage, "Location permission needed")}
                            </h2>
                            <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                              {requesterText(uiLanguage, locationMessage)}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {false && locationState ===
                      "failed" ? (
                        <div className="absolute inset-0 z-30 overflow-y-auto bg-[#fff6f5]/96 px-5 py-6 backdrop-blur-sm">
                          <div className="mx-auto flex min-h-full max-w-md flex-col justify-center">
                            <div className="text-center">
                              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#ffdddd] text-[#c73937]">
                                <MapPin className="h-6 w-6" />
                              </span>

                              <h2 className="mt-3 font-semibold text-[#102b3f]">
                                {requesterText(uiLanguage, "Location could not be confirmed")}
                              </h2>

                              <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                                {requesterText(uiLanguage, locationMessage)}
                              </p>

                              <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                                {requesterText(uiLanguage, "Enter your address manually below, or retry GPS.")}
                              </p>
                            </div>

                            <div className="mt-5">
                              {error ? (
                                <p className="mt-2 text-sm text-[#c73937]">
                                  {error}
                                </p>
                              ) : null}

                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                <Button
                                  variant="outline"
                                  onClick={
                                    startLocationSequence
                                  }
                                >
                                  <RefreshCw className="h-4 w-4" />
                                  {requesterText(uiLanguage, "Retry GPS")}
                                </Button>

                                <Button
                                  disabled
                                  onClick={async () => {
                                    const query =
                                      manualAddress.trim();

                                    if (!query) {
                                      setError(
                                        "Please enter your address."
                                      );
                                      return;
                                    }

                                    setError("");
                                    setIsGeocoding(
                                      true
                                    );

                                    try {
                                      const response =
                                        await fetch(
                                          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
                                            query
                                          )}`
                                        );

                                      if (
                                        !response.ok
                                      ) {
                                        throw new Error(
                                          "Address lookup failed"
                                        );
                                      }

                                      const data: SuggestionItem[] =
                                        await response.json();

                                      if (
                                        !data.length
                                      ) {
                                        setError(
                                          "We could not find that address. Please check it and try again."
                                        );
                                        return;
                                      }

                                      const result =
                                        data[0];

                                      const lat =
                                        Number.parseFloat(
                                          result.lat
                                        );

                                      const lng =
                                        Number.parseFloat(
                                          result.lon
                                        );

                                      if (
                                        !Number.isFinite(
                                          lat
                                        ) ||
                                        !Number.isFinite(
                                          lng
                                        )
                                      ) {
                                        setError(
                                          "The address returned an invalid location."
                                        );
                                        return;
                                      }

                                      setCoordinates({
                                        lat,
                                        lng,
                                      });

                                      setAccuracy(
                                        undefined
                                      );

                                      setAddress(
                                        result.display_name ||
                                          query
                                      );

                                      setSuggestions(
                                        []
                                      );

                                      setLocationState(
                                        "success"
                                      );

                                      setLocationMessage(
                                        "Manual location confirmed"
                                      );

                                      await wait(
                                        1000
                                      );

                                      setStep(2);
                                    } catch {
                                      setError(
                                        "We could not look up that address. Please check your connection and try again."
                                      );
                                    } finally {
                                      setIsGeocoding(
                                        false
                                      );
                                    }
                                  }}
                                >
                                  {isGeocoding ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      {requesterText(uiLanguage, "Searching…")}
                                    </>
                                  ) : (
                                    <>
                                      <Check className="h-4 w-4" />
                                      {requesterText(uiLanguage, "Confirm address")}
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid content-start gap-3 lg:order-1">
                      {locationState ===
                        "success" &&
                      coordinates ? (
                        <div className="flex items-center gap-3 border-y border-[#dce7e2] bg-[#f1f9f5] px-4 py-3 text-[#285f49] md:border md:p-4">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#1f845b]">
                            <CheckCircle2 className="h-5 w-5" />
                          </span>

                          <div className="min-w-0">
                            <p className="font-semibold">
                              {requesterText(uiLanguage, "Location confirmed")}
                            </p>

                            <p className="mt-1 truncate text-xs">
                              {coordinates.lat.toFixed(
                                5
                              )}
                              ,{" "}
                              {coordinates.lng.toFixed(
                                5
                              )}
                              {accuracy
                                ? ` · ±${Math.round(
                                    accuracy
                                  )}m`
                                : ""}
                            </p>

                            {address ? (
                              <p className="mt-1 truncate text-xs">
                                {address}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="hidden items-center gap-3 bg-[#f3f7f8] px-4 py-3 text-sm text-[#617683] lg:flex">
                          <LocateFixed className="h-5 w-5 shrink-0 text-[#0f6872]" />

                          <p>
                            {requesterText(uiLanguage, "Keep location permission enabled while we confirm your device position.")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* STEP 2 - CONFIRM */

                  <div className="grid gap-4 lg:grid-cols-[1fr_0.82fr] lg:gap-6">
                    <div>
                      <h2 className="text-xl font-semibold">
                        {requesterText(uiLanguage, "Check before submitting")}
                      </h2>

                      <p className="mt-2 text-sm leading-6 text-[#687b89]">
                        {requesterText(uiLanguage, "Your current position is confirmed and the request is ready to send.")}
                      </p>

                      <dl className="mt-4 divide-y divide-[#e2e8ed] border-y border-[#e2e8ed] text-sm">
                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            {requesterText(uiLanguage, "Emergency")}
                          </dt>

                          <dd className="mt-1 font-semibold">
                            {requesterText(uiLanguage, category)} · {requesterText(uiLanguage, severity)}
                          </dd>
                        </div>

                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            {requesterText(uiLanguage, "Description")}
                          </dt>

                          <dd className="mt-1 line-clamp-2 leading-6">
                            {note ||
                              requesterText(uiLanguage, "No additional description provided.")}
                          </dd>
                        </div>

                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            {requesterText(uiLanguage, "Confirmed location")}
                          </dt>

                          <dd className="mt-1 font-semibold">
                            {address ||
                              requesterText(uiLanguage, "Current device location")}
                          </dd>

                          {coordinates ? (
                            <dd className="mt-1 text-xs text-[#71828d]">
                              {coordinates.lat.toFixed(
                                6
                              )}
                              ,{" "}
                              {coordinates.lng.toFixed(
                                6
                              )}{" "}
                              ·{" "}
                              {manualAddress.trim()
                                ? requesterText(uiLanguage, "Manual")
                                : requesterText(uiLanguage, "GPS")}
                            </dd>
                          ) : null}
                        </div>
                      </dl>
                    </div>

                    <div className="bg-[#fff0ef] p-4 md:p-5">
                      <Siren className="h-6 w-6 text-[#d53f3d] md:h-7 md:w-7" />

                      <h3 className="mt-3 font-semibold">
                        {requesterText(uiLanguage, "Confirm emergency request")}
                      </h3>

                      <p className="mt-2 text-sm leading-5 text-[#705f5f]">
                        {requesterText(uiLanguage, "The request will be sent to the response coordination service.")}
                      </p>

                      <div className="mt-4 bg-white/75 px-4 py-3.5">
                        {submitting ||
                        confirmCountdown ===
                          0 ? (
                          <div className="flex items-center gap-3">
                            <Loader2 className="h-5 w-5 animate-spin text-[#d53f3d]" />

                            <div>
                              <p className="text-sm font-semibold text-[#7b4746]">
                                {requesterText(uiLanguage, "Submitting request")}
                              </p>

                              <p className="mt-1 text-xs text-[#8a5b59]">
                                {requesterText(uiLanguage, "Opening live tracking…")}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-[#7b4746]">
                              {requesterText(uiLanguage, "Automatic submission")}
                            </p>

                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#f2d5d4]">
                              <motion.div
                                className="h-full bg-[#d53f3d]"
                                initial={{
                                  width: "0%",
                                }}
                                animate={{
                                  width: `${
                                    ((CONFIRM_REVIEW_SECONDS -
                                      confirmCountdown) /
                                      CONFIRM_REVIEW_SECONDS) *
                                    100
                                  }%`,
                                }}
                                transition={{
                                  duration: 0.25,
                                }}
                              />
                            </div>

                            <p className="mt-2 text-xs text-[#8a5b59]">
                              {requesterText(uiLanguage, "Sending in {seconds} seconds.", { seconds: confirmCountdown })}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {error ? (
              <p className="mx-5 mb-4 border-l-4 border-[#d53f3d] bg-[#ffefee] p-3 text-sm font-medium text-[#a93331] md:mx-6">
                {requesterText(uiLanguage, error)}
              </p>
            ) : null}

            {step === 0 ? (
              <div className="flex justify-end border-t border-[#e2e8ed] p-4 sm:px-6">
                <Button
                  onClick={() => {
                    setError("");
                    setStep(1);
                  }}
                >
                  {requesterText(uiLanguage, "Continue")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : step === 1 ? (
              <div className="flex items-center justify-between border-t border-[#e2e8ed] p-4 sm:px-6">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    setStep(0);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {requesterText(uiLanguage, "Back")}
                </Button>

                <span className="text-xs font-medium text-[#71838f]">
                  {locationState ===
                  "success"
                    ? requesterText(uiLanguage, "Opening confirmation…")
                    : requesterText(uiLanguage, "Location required")}
                </span>
              </div>
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}

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
import { LiveResponseMap } from "@/components/maps/live-response-map";

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
};

const LOCATION_ATTEMPTS = 3;
const ATTEMPT_SECONDS = 15;
const RETRY_DELAY_SECONDS = 5;
const CONFIRM_REVIEW_SECONDS = 5;
const MAX_NOTE_LENGTH = 200;

/* ---------------------------------------------------------------------- */
/* Middleware API response helpers                                        */
/* ---------------------------------------------------------------------- */

type RequestListItem = {
  id: string;
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

type ActiveQuestion = {
  question: string;
  options: string[];
};

function activeQuestionsFor(category: string | null): ActiveQuestion[] {
  if (category === "Police") {
    return [
      {
        question: "What kind of situation is this?",
        options: [
          "Crime in progress",
          "Suspicious activity",
          "Personal safety",
          "Other",
        ],
      },
      {
        question: "Is it happening right now?",
        options: [
          "Yes, right now",
          "Just happened",
          "Not currently",
          "I am not sure",
        ],
      },
    ];
  }

  if (category === "Firefighting") {
    return [
      {
        question: "What kind of fire emergency is this?",
        options: [
          "Building or house fire",
          "Vehicle fire",
          "Smoke or suspected fire",
          "Other",
        ],
      },
      {
        question: "Is anyone in immediate danger?",
        options: [
          "Yes",
          "No",
          "I am not sure",
        ],
      },
    ];
  }

  return [
    {
      question: "What kind of medical emergency is this?",
      options: [
        "Vehicle accident",
        "Injury or trauma",
        "Breathing problem",
        "Other",
      ],
    },
    {
      question: "How many people are involved?",
      options: [
        "One person",
        "Two people",
        "Three or more",
        "I am not sure",
      ],
    },
  ];
}

function ActiveRequestQuestions({
  category,
  requestId,
}: {
  category: string | null;
  requestId: string | null;
}) {
  const questions = activeQuestionsFor(category);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [additionalHelp, setAdditionalHelp] = useState<boolean | null>(null);
  const [complete, setComplete] = useState(false);

  function finish(nextAnswers: string[], extra?: string) {
    setComplete(true);
    writeFreshCache(
      `requester-active-details:${requestId ?? "current"}`,
      {
        answers: nextAnswers,
        additionalHelp: extra ?? null,
      },
      5 * 60_000,
    );
  }

  function chooseAnswer(answer: string) {
    const nextAnswers = [
      ...answers.slice(0, questionIndex),
      answer,
    ];
    setAnswers(nextAnswers);

    if (questionIndex >= questions.length - 1) {
      finish(nextAnswers);
      return;
    }

    setQuestionIndex((current) => current + 1);
  }

  if (complete) {
    return (
      <div className="mt-6 px-1 text-center">
        <CheckCircle2 className="mx-auto h-6 w-6 text-[#0f6872]" />
        <p className="mt-2 text-sm font-semibold text-[#102b3f]">
          Thanks. These details have been recorded on this device.
        </p>
      </div>
    );
  }

  if (additionalHelp === null) {
    return (
      <div className="mt-6 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">
          Optional additional help
        </p>
        <h3 className="mt-4 font-semibold text-[#102b3f]">
          Do you need another type of help with this active request?
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#71838f]">
          Choose an option below. This will not create a second emergency request.
        </p>

        <div className="mt-3 divide-y divide-[#dfe7ec]">
          {[
            { label: "Yes, I need additional help", value: true },
            { label: "No, continue with this request", value: false },
          ].map((option, optionIndex) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setAdditionalHelp(option.value)}
              className="group flex w-full items-center gap-3 px-1 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:text-[#0f6872]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4eaee] text-xs font-semibold text-[#788a95] transition group-hover:bg-[#0f6872] group-hover:text-white">
                {optionIndex + 1}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (additionalHelp) {
    const additionalHelpOptions = [
      "Medical assistance",
      "Police assistance",
      "Firefighting assistance",
      "Rescue assistance",
    ];

    return (
      <div className="mt-6 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">
          Additional help type
        </p>
        <h3 className="mt-4 font-semibold text-[#102b3f]">
          What type of additional help do you need?
        </h3>

        <div className="mt-3 divide-y divide-[#dfe7ec]">
          {additionalHelpOptions.map((option, optionIndex) => (
            <button
              key={option}
              type="button"
              onClick={() => finish(answers, option)}
              className="group flex w-full items-center gap-3 px-1 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:text-[#0f6872]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4eaee] text-xs font-semibold text-[#788a95] transition group-hover:bg-[#0f6872] group-hover:text-white">
                {optionIndex + 1}
              </span>
              <span>{option}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const currentQuestion = questions[questionIndex];

  return (
    <div className="mt-6 px-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">
          Optional details
        </p>
        <span className="text-xs font-semibold text-[#758793]">
          {questionIndex + 1} of {questions.length}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={questionIndex}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
          className="mt-4"
        >
          <h3 className="font-semibold text-[#102b3f]">
            {currentQuestion.question}
          </h3>

          <div className="mt-3 divide-y divide-[#dfe7ec]">
            {currentQuestion.options.map((option, optionIndex) => (
              <button
                key={option}
                type="button"
                onClick={() => chooseAnswer(option)}
                className="group flex w-full items-center gap-3 px-1 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:text-[#0f6872]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4eaee] text-xs font-semibold text-[#788a95] transition group-hover:bg-[#0f6872] group-hover:text-white">
                  {optionIndex + 1}
                </span>
                <span>{option}</span>
              </button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setComplete(true)}
        className="mx-auto mt-3 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2"
      >
        Skip these questions
      </button>
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

  const selectedMainCategory =
    searchParams.get("category");

  const categoryOptions =
    selectedMainCategory === "Police"
      ? POLICE_CATEGORIES
      : selectedMainCategory === "Firefighting"
        ? FIREFIGHTING_CATEGORIES
      : MEDICAL_CATEGORIES;

  const [step, setStep] = useState(0);

  const [category, setCategory] = useState(
    categoryOptions[0]
  );

  const [severity, setSeverity] =
    useState<Severity>("High");

  const [note, setNote] = useState("");

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

  const [activeRequestReady, setActiveRequestReady] =
    useState(() => Boolean(initialActiveRequest));

  const locationRunRef =
    useRef(0);

  const countdownTimerRef =
    useRef<number | null>(null);

  const autoSubmitRef =
    useRef(false);

  const hasStartedExpressFlow = useRef(false);

  /*
   * One stable idempotency key is used for this logical submission.
   * If the browser retries after a network failure, the middleware
   * can return the existing request instead of creating a duplicate.
   */
  const idempotencyKeyRef =
    useRef<string | null>(null);

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
        `Attempt ${attemptNumber} of ${LOCATION_ATTEMPTS}`
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
            `Attempt ${attemptNumber} was unsuccessful`
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
    []
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

  /* Ambulance and police buttons are designed for an express request: details
   * are optional, so a user can go straight from the chosen service to location
   * confirmation. The setting stays local to the device. */
  useEffect(() => {
    if (!selectedMainCategory || step !== 0 || hasStartedExpressFlow.current) return;
    const preferences = readRequesterPreferences();
    if (!preferences.skipIncidentDetails) return;
    hasStartedExpressFlow.current = true;
    setStep(1);
  }, [selectedMainCategory, step]);

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
          writeFreshCache(cacheKey, { id: active.id }, 5 * 60_000);
        } else {
          setHasActiveRequest(false);
          setActiveRequestId(null);
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
      {!hasActiveRequest ? (
        <PageHeading
          title="Request assistance"
          description={
            <>
              <span className="md:hidden">
                Complete only the essential incident information.
              </span>
              <span className="hidden md:inline">
                Complete only the essential incident information. Contact details are taken from your profile.
              </span>
            </>
          }
        />
      ) : null}

      {hasActiveRequest ? (
        <div>
          <Panel
            mobileCard={false}
            className="-mx-5 border-x-0 border-[#f0c8c7] bg-[#fff7f6] p-5 md:mx-0 md:rounded-[22px] md:border-x"
          >
            <div className="flex gap-3">
              <Siren className="h-5 w-5 shrink-0 text-[#d53f3d]" />

              <div>
                <h2 className="font-semibold">
                  An active request already exists
                </h2>

                <p className="mt-1 text-sm text-[#6d6060]">
                  Open your active request
                  instead of creating a
                  duplicate request.
                </p>

                {activeRequestId ? (
                  <Button
                    variant="danger"
                    className="mt-4"
                    onClick={() =>
                      router.push(
                        `/app/requester/track/${activeRequestId}`
                      )
                    }
                  >
                    Open active request
                  </Button>
                ) : null}
              </div>
            </div>
          </Panel>

          <ActiveRequestQuestions
            category={selectedMainCategory}
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
                    {label}
                  </span>
                </div>
              )
            )}
          </div>

          <Panel
            mobileCard={false}
          className="-mx-5 border-x-0 border-b-0 bg-transparent shadow-none md:mx-0 md:border-x md:bg-white"
          >
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
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        <FieldLabel>
                          Emergency category
                        </FieldLabel>

                        <Select
                          value={category}
                          onChange={(event) =>
                            setCategory(
                              event.target.value
                            )
                          }
                        >
                          {categoryOptions.map(
                            (option) => (
                              <option
                                key={option}
                                value={option}
                              >
                                {option}
                              </option>
                            )
                          )}
                        </Select>
                      </label>

                      <label>
                        <FieldLabel>
                          Priority
                        </FieldLabel>

                        <Select
                          value={severity}
                          onChange={(event) =>
                            setSeverity(
                              event.target
                                .value as Severity
                            )
                          }
                        >
                          <option value="Critical">
                            Critical
                          </option>

                          <option value="High">
                            High
                          </option>

                          <option value="Moderate">
                            Moderate
                          </option>
                        </Select>
                      </label>
                    </div>

                    <label>
                      <div className="flex items-center justify-between">
                        <FieldLabel>
                          Short description
                        </FieldLabel>

                        <span className="text-xs text-[#788a95]">
                          {note.length}/
                          {MAX_NOTE_LENGTH}
                        </span>
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
                        placeholder="What happened and what help is needed?"
                      />
                    </label>

                  <div className="hidden items-start gap-3 bg-[#f3f7f8] px-4 py-3.5 text-sm text-[#5f7480] md:flex">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1f845b]" />
                    <p className="leading-6">
                      Your saved callback number is attached to this request:{" "}
                      <span className="font-semibold text-[#102b3f]">
                        {user.phone || "your registered contact number"}
                      </span>.
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
                              Locating your device
                            </h2>

                            <p className="mt-2 text-sm text-[#617683]">
                              {locationState ===
                              "retrying"
                                ? locationMessage
                                : `${locationMessage} · ${attemptCountdown}s`}
                            </p>

                          </div>
                        </div>
                      ) : null}

                      {locationState === "failed" ? (
                        <div className="absolute inset-0 z-30 grid place-items-center bg-[#fff6f5]/96 px-5 text-center backdrop-blur-sm">
                          <div className="max-w-sm">
                            <MapPin className="mx-auto h-7 w-7 text-[#c73937]" />
                            <h2 className="mt-3 font-semibold text-[#102b3f]">
                              Location permission needed
                            </h2>
                            <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                              {locationMessage}
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
                                Location could not be confirmed
                              </h2>

                              <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                                {locationMessage}
                              </p>

                              <p className="mt-2 text-sm leading-5 text-[#6f6767]">
                                Enter your address manually below, or retry GPS.
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
                                  Retry GPS
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
                                      Searching…
                                    </>
                                  ) : (
                                    <>
                                      <Check className="h-4 w-4" />
                                      Confirm address
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
                              Location confirmed
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
                            Keep location permission enabled while we confirm your device position.
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
                        Check before submitting
                      </h2>

                      <p className="mt-2 text-sm leading-6 text-[#687b89]">
                        Your current position is confirmed and the request is ready to send.
                      </p>

                      <dl className="mt-4 divide-y divide-[#e2e8ed] border-y border-[#e2e8ed] text-sm">
                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            Emergency
                          </dt>

                          <dd className="mt-1 font-semibold">
                            {category} · {severity}
                          </dd>
                        </div>

                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            Description
                          </dt>

                          <dd className="mt-1 line-clamp-2 leading-6">
                            {note ||
                              "No additional description provided."}
                          </dd>
                        </div>

                        <div className="py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#798994]">
                            Confirmed location
                          </dt>

                          <dd className="mt-1 font-semibold">
                            {address ||
                              "Current device location"}
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
                                ? "Manual"
                                : "GPS"}
                            </dd>
                          ) : null}
                        </div>
                      </dl>
                    </div>

                    <div className="bg-[#fff0ef] p-4 md:p-5">
                      <Siren className="h-6 w-6 text-[#d53f3d] md:h-7 md:w-7" />

                      <h3 className="mt-3 font-semibold">
                        Confirm emergency request
                      </h3>

                      <p className="mt-2 text-sm leading-5 text-[#705f5f]">
                        The request will be sent to the response coordination service.
                      </p>

                      <div className="mt-4 bg-white/75 px-4 py-3.5">
                        {submitting ||
                        confirmCountdown ===
                          0 ? (
                          <div className="flex items-center gap-3">
                            <Loader2 className="h-5 w-5 animate-spin text-[#d53f3d]" />

                            <div>
                              <p className="text-sm font-semibold text-[#7b4746]">
                                Submitting request
                              </p>

                              <p className="mt-1 text-xs text-[#8a5b59]">
                                Opening live tracking…
                              </p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-[#7b4746]">
                              Automatic submission
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
                              Sending in{" "}
                              {confirmCountdown}{" "}
                              seconds.
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
                {error}
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
                  Continue
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
                  Back
                </Button>

                <span className="text-xs font-medium text-[#71838f]">
                  {locationState ===
                  "success"
                    ? "Opening confirmation…"
                    : "Location required"}
                </span>
              </div>
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}

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

const LOCATION_ATTEMPTS = 3;
const ATTEMPT_SECONDS = 5;
const CONFIRM_REVIEW_SECONDS = 5;
const MAX_NOTE_LENGTH = 200;

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

function wait(milliseconds: number) {
  return new Promise((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}

function requestBrowserLocation() {
  return new Promise<GeolocationPosition>(
    (resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "Geolocation is not supported by this browser."
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          timeout: ATTEMPT_SECONDS * 1000,
          maximumAge: 0,
        }
      );
    }
  );
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

  const [isGeocoding, setIsGeocoding] =
    useState(false);

  const [accuracy, setAccuracy] =
    useState<number | undefined>();

  const [address, setAddress] =
    useState("");

  const [manualAddress, setManualAddress] =
    useState("");

  const [suggestions, setSuggestions] =
    useState<SuggestionItem[]>([]);

  const [
    isSearchingSuggestions,
    setIsSearchingSuggestions,
  ] = useState(false);

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

  const [
    hasActiveRequest,
    setHasActiveRequest,
  ] = useState(false);

  const [
    activeRequestId,
    setActiveRequestId,
  ] = useState<string | null>(null);

  const locationRunRef =
    useRef(0);

  const countdownTimerRef =
    useRef<number | null>(null);

  const autoSubmitRef =
    useRef(false);

  /* ---------------------------------------------------------------------- */
  /* Address suggestions                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const query = manualAddress.trim();

    if (
      query.length < 3 ||
      locationState !== "failed"
    ) {
      setSuggestions([]);
      setIsSearchingSuggestions(false);
      return;
    }

    setIsSearchingSuggestions(true);

    const timer = window.setTimeout(
      async () => {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
              query
            )}`
          );

          if (!response.ok) {
            throw new Error(
              "Address search failed"
            );
          }

          const data: SuggestionItem[] =
            await response.json();

          setSuggestions(data);
        } catch {
          setSuggestions([]);
        } finally {
          setIsSearchingSuggestions(false);
        }
      },
      400
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [manualAddress, locationState]);

  function handleSelectSuggestion(
    item: SuggestionItem
  ) {
    const lat = Number.parseFloat(item.lat);
    const lng = Number.parseFloat(item.lon);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      setError(
        "The selected address could not be located."
      );
      return;
    }

    setManualAddress(item.display_name);
    setCoordinates({ lat, lng });
    setAccuracy(undefined);
    setAddress(item.display_name);
    setSuggestions([]);
    setLocationState("success");
    setLocationMessage(
      "Manual location confirmed"
    );

    void (async () => {
      await wait(1000);
      setStep(2);
    })();
  }

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

        try {
          const realAddress =
            await getAddressFromCoordinates(
              nextCoordinates.lat,
              nextCoordinates.lng
            );

          setAddress(realAddress);
        } catch (error) {
          console.error(
            "Failed to reverse geocode location:",
            error
          );

          setAddress(
            `${nextCoordinates.lat.toFixed(
              6
            )}, ${nextCoordinates.lng.toFixed(
              6
            )}`
          );
        }

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

        const message =
          locationErrorCode === 1
            ? "Location permission was not granted. Allow location access and try again."
            : "LIVE could not confirm your location after three attempts.";

        setLocationState("failed");

        setLocationMessage(message);

        setError(
          "Your request cannot continue until your current location is confirmed."
        );
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

  /* ---------------------------------------------------------------------- */
  /* Check for an existing active request                                   */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
  if (!user?.id) {
    return;
  }

  const requesterId = user.id;

  async function checkActiveRequest() {
    try {
      const response = await fetch(
        `/api/requests?requesterId=${encodeURIComponent(
          requesterId
        )}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      const requests = data?.requests ?? [];

      const active = requests.find(
        (request: {
          id: string;
          current_status: string;
        }) =>
          [
            "submitted",
            "received",
            "assigned",
            "en_route",
            "arrived",
          ].includes(request.current_status)
      );

      if (active) {
        setHasActiveRequest(true);
        setActiveRequestId(active.id);
      }
    } catch (error) {
      console.error(
        "Failed to check active request:",
        error
      );
    }
  }

  checkActiveRequest();
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

      autoSubmitRef.current = true;
      setSubmitting(true);
      setError("");

      try {
        const response =
          await fetch(
            "/api/requests",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              credentials: "include",

              body: JSON.stringify({
                requesterId:
                  user.id,

                category,

                severity,

                note:
                  note ||
                  "No additional note provided.",

                callbackNumber:
                  user.phone || null,

                location: {
                  address:
                    address ||
                    "Current device location",

                  lat:
                    coordinates.lat,

                  lng:
                    coordinates.lng,

                  accuracy:
                    accuracy ?? null,

                  capturedAt:
                    new Date().toISOString(),

                  method:
                    manualAddress.trim()
                      ? "Manual"
                      : "GPS",
                },
              }),
            }
          );

        let data: {
          request?: {
            id: string;
            reference_code?: string;
          };
          error?: string;
        } | null = null;

        try {
          data =
            await response.json();
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

        if (
          !response.ok ||
          !data?.request
        ) {
          throw new Error(
            data?.error ||
              "Failed to create emergency request."
          );
        }

        /*
         * Use the real Supabase UUID
         * returned by the API.
         */
        router.replace(
          `/app/requester/track/${data.request.id}`
        );
      } catch (error) {
        console.error(
          "Failed to submit emergency request:",
          error
        );

        setSubmitting(false);

        autoSubmitRef.current =
          false;

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
      manualAddress,
      note,
      router,
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

  if (!user) {
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
        eyebrow="Emergency request"
        title="Request assistance"
        description="Complete only the essential incident information. Contact details are taken from your profile."
      />

      {hasActiveRequest ? (
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
            className="-mx-5 border-x-0 border-b-0 bg-transparent shadow-none md:mx-0 md:rounded-[22px] md:border md:bg-white md:shadow-[0_14px_38px_rgba(16,43,63,.07)]"
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

                    <div className="flex items-start gap-3 bg-[#f3f7f8] px-4 py-3.5 text-sm text-[#5f7480]">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1f845b]" />

                      <p className="leading-6">
                        LIVE will use{" "}
                        <span className="font-semibold text-[#102b3f]">
                          {user.phone ||
                            "your registered contact number"}
                        </span>{" "}
                        as the callback
                        number.
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
                                ? "Preparing the next attempt"
                                : `${locationMessage} · ${attemptCountdown}s`}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {locationState ===
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
                              <label className="block">
                                <FieldLabel>
                                  Manual address
                                </FieldLabel>

                                <div className="relative mt-1">
                                  <input
                                    type="text"
                                    value={manualAddress}
                                    onChange={(
                                      event
                                    ) => {
                                      setManualAddress(
                                        event
                                          .target
                                          .value
                                      );
                                      setError("");
                                    }}
                                    placeholder="Enter your street address or location"
                                    className="w-full rounded-lg border border-[#c2d1d9] bg-white px-3 py-3 pr-10 text-sm text-[#102b3f] outline-none focus:border-[#1f6f8b] focus:ring-2 focus:ring-[#1f6f8b]/20"
                                  />

                                  {isSearchingSuggestions ? (
                                    <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-[#7a8c98]" />
                                  ) : (
                                    <Search className="absolute right-3 top-3 h-4 w-4 text-[#7a8c98]" />
                                  )}
                                </div>
                              </label>

                              {suggestions.length >
                              0 ? (
                                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#c2d1d9] bg-white shadow-lg">
                                  {suggestions.map(
                                    (item) => (
                                      <button
                                        key={
                                          item.place_id
                                        }
                                        type="button"
                                        onClick={() =>
                                          handleSelectSuggestion(
                                            item
                                          )
                                        }
                                        className="block w-full border-b border-[#edf1f3] px-3 py-3 text-left text-sm text-[#102b3f] hover:bg-[#f3f7f8] last:border-b-0"
                                      >
                                        {
                                          item.display_name
                                        }
                                      </button>
                                    )
                                  )}
                                </div>
                              ) : null}

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
                                  disabled={
                                    !manualAddress.trim() ||
                                    isGeocoding
                                  }
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
                            Keep location permission
                            enabled while LIVE checks
                            your device position.
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
                        LIVE confirmed your current
                        position and prepared the
                        request for submission.
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
                        This demo does not contact
                        real emergency services.
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
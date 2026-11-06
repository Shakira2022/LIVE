"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { REQUESTER_LANGUAGES, readRequesterLanguage, saveRequesterLanguage, type RequesterLanguage } from "@/lib/requester-language";
import { loadRequesterPreferences, readRequesterPreferences, saveRequesterPreferences, type RequesterPreferences } from "@/lib/requester-preferences";
import { regionalDefaultTheme } from "@/lib/display-theme";
import type { DisplayTheme } from "@/types";

type ResponderVoicePreferences = { voiceNavigation: boolean; voiceGuidance: boolean };
type SetupStep = "vision" | "language" | "voice" | "display";

const DEFAULT_RESPONDER_VOICE: ResponderVoicePreferences = { voiceNavigation: false, voiceGuidance: false };

function readResponderVoice(userId: string): ResponderVoicePreferences {
  if (typeof window === "undefined") return DEFAULT_RESPONDER_VOICE;
  try {
    const value = window.localStorage.getItem(`live-responder-preferences:${userId}`);
    return value ? { ...DEFAULT_RESPONDER_VOICE, ...JSON.parse(value) } : DEFAULT_RESPONDER_VOICE;
  } catch {
    return DEFAULT_RESPONDER_VOICE;
  }
}

function ChoiceRow({
  title,
  description,
  selected,
  onClick,
  disabled = false,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-16 w-full items-center justify-between gap-4 border-b border-[#dce5ea] px-1 py-3 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${selected ? "text-[#0f6872]" : "text-[#102b3f]"}`}
    >
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        {description ? <span className="mt-1 block text-sm leading-6 text-[#667b89]">{description}</span> : null}
      </span>
      <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-[#0f6872]" : "border-[#aebfc9]"}`}>
        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-[#0f6872]" /> : null}
      </span>
    </button>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 border-b border-[#dce5ea] px-1 py-4 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[#102b3f]">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-[#667b89]">{description}</span>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`relative mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border text-[8px] font-bold leading-none transition ${checked ? "justify-start border-[#0f5b67] bg-[#0f5b67] pl-1 text-white" : "justify-end border-[#aebfc9] bg-transparent pr-1 text-[#667b89]"}`}>
        {checked ? "ON" : "OFF"}
        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition ${checked ? "right-0.5 bg-white" : "left-0.5 bg-[#6e808c]"}`} />
      </span>
    </label>
  );
}

export function SettingsSetupSheet() {
  const { user, updateDisplayTheme, completeSettingsSetup } = useAuth();
  const [step, setStep] = useState<SetupStep>("vision");
  const [visionAnswer, setVisionAnswer] = useState<boolean | null>(null);
  const [language, setLanguage] = useState<RequesterLanguage>(() => user ? readRequesterLanguage(user.id) : "English");
  const [theme, setTheme] = useState<DisplayTheme>(() => user?.displayTheme ?? regionalDefaultTheme());
  const [requesterVoice, setRequesterVoice] = useState<RequesterPreferences>(() => user ? readRequesterPreferences(user.id) : readRequesterPreferences());
  const [responderVoice, setResponderVoice] = useState<ResponderVoicePreferences>(() => user ? readResponderVoice(user.id) : DEFAULT_RESPONDER_VOICE);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const originalRequesterVoice = useRef(requesterVoice);
  const originalResponderVoice = useRef(responderVoice);
  const blindPresetApplied = useRef(false);
  useEffect(() => {
    document.getElementById("settings-setup-step-title")?.focus();
  }, [step]);

  useEffect(() => {
    if (user?.role !== "requester") return;
    let cancelled = false;
    void loadRequesterPreferences(user.id).then((loaded) => {
      if (cancelled) return;
      setRequesterVoice(loaded);
      originalRequesterVoice.current = loaded;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  if (!user) return null;
  const currentUser = user;

  const voiceSettingsAvailable = currentUser.role === "requester" || currentUser.role === "responder";
  const steps: SetupStep[] = ["vision", "language", ...(voiceSettingsAvailable ? ["voice" as const] : []), "display"];
  const stepIndex = steps.indexOf(step);

  function applyRequesterVoice(next: RequesterPreferences) {
    setRequesterVoice(next);
    saveRequesterPreferences(next, currentUser.id);
    window.dispatchEvent(new Event("live:requester-preferences-changed"));
    if (next.voiceNavigation) window.dispatchEvent(new Event("live:requester-voice-activate"));
  }

  function applyResponderVoice(next: ResponderVoicePreferences) {
    setResponderVoice(next);
    window.localStorage.setItem(`live-responder-preferences:${currentUser.id}`, JSON.stringify(next));
  }

  function applyBlindPreset() {
    if (currentUser.role === "requester") {
      applyRequesterVoice({
        ...requesterVoice,
        voiceNavigation: true,
        voiceGuidance: true,
        blindVoiceGuidance: true,
        voiceCommandsActive: true,
      });
    } else if (currentUser.role === "responder") {
      applyResponderVoice({ voiceNavigation: true, voiceGuidance: true });
    }
    blindPresetApplied.current = true;
  }

  function restoreVoiceBeforeBlindChoice() {
    if (!blindPresetApplied.current) return;
    if (currentUser.role === "requester") applyRequesterVoice(originalRequesterVoice.current);
    else if (currentUser.role === "responder") applyResponderVoice(originalResponderVoice.current);
    blindPresetApplied.current = false;
  }

  function chooseBlind(value: boolean) {
    setVisionAnswer(value);
    if (value && !blindPresetApplied.current) applyBlindPreset();
    if (!value) restoreVoiceBeforeBlindChoice();
  }

  function chooseLanguage(value: RequesterLanguage) {
    setLanguage(value);
    saveRequesterLanguage(currentUser.id, value);
  }

  async function chooseTheme(value: DisplayTheme) {
    const previousTheme = theme;
    setTheme(value);
    const saved = await updateDisplayTheme(value);
    if (!saved) {
      setTheme(currentUser.displayTheme ?? previousTheme);
      setError("Your display preference could not be saved. Try again.");
    }
    else setError("");
  }

  function updateRequesterVoice<K extends keyof RequesterPreferences>(key: K, value: RequesterPreferences[K]) {
    const next = {
      ...requesterVoice,
      [key]: value,
      ...(key === "voiceNavigation" && value === true ? { voiceCommandsActive: true } : {}),
    };
    applyRequesterVoice(next);
  }

  function updateResponderVoice<K extends keyof ResponderVoicePreferences>(key: K, value: ResponderVoicePreferences[K]) {
    applyResponderVoice({ ...responderVoice, [key]: value });
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setError("");
    try {
      await completeSettingsSetup();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Unable to save your setup. Try again.");
      setFinishing(false);
    }
  }

  function next() {
    if (step === "vision" && visionAnswer === null) return;
    if (step === "vision" && visionAnswer) {
      void finish();
      return;
    }
    const nextStep = steps[stepIndex + 1];
    if (nextStep) setStep(nextStep);
    else void finish();
  }

  function previous() {
    const previousStep = steps[stepIndex - 1];
    if (previousStep) setStep(previousStep);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="settings-setup-title" className="fixed inset-0 z-[121] overflow-y-auto bg-[#f6f8fb] text-[#102b3f]">
      <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 pb-28 pt-6 sm:px-6 sm:pt-8">
        <header className="border-b border-[#dce5ea] pb-5">
          <h1 id="settings-setup-title" tabIndex={-1} className="text-2xl font-bold tracking-[-0.02em] text-[#102b3f]">Set up LIVE</h1>
          <p className="mt-2 text-sm leading-6 text-[#667b89]">Choose your preferences. You can change them later in Settings.</p>
          <p className="mt-3 text-xs font-semibold text-[#0f6872]">Step {stepIndex + 1} of {steps.length}</p>
        </header>

        <section className="py-5">
          {step === "vision" ? (
            <div>
              <h2 id="settings-setup-step-title" tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f6872]">Are you blind or do you need spoken guidance to use LIVE?</h2>
              <p className="mt-2 text-sm leading-6 text-[#667b89]">Choosing Yes turns on the available voice settings for your account. Voice navigation may ask for microphone access.</p>
              <div className="mt-4 border-y border-[#dce5ea]">
                <ChoiceRow title="Yes, set up voice access" description="Enable the voice settings available for your account." selected={visionAnswer === true} onClick={() => chooseBlind(true)} disabled={finishing} />
                <ChoiceRow title="No" selected={visionAnswer === false} onClick={() => chooseBlind(false)} disabled={finishing} />
              </div>
            </div>
          ) : null}

          {step === "language" ? (
            <div>
              <h2 id="settings-setup-step-title" tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f6872]">Language preference</h2>
              <p className="mt-2 text-sm leading-6 text-[#667b89]">Choose the language LIVE uses for your account.</p>
              <div className="mt-4 border-y border-[#dce5ea]">
                {REQUESTER_LANGUAGES.map((option) => <button key={option} type="button" disabled={finishing} aria-pressed={language === option} onClick={() => chooseLanguage(option)} className={`flex min-h-12 w-full items-center justify-between border-b border-[#dce5ea] px-1 text-left text-sm last:border-b-0 disabled:opacity-60 ${language === option ? "font-bold text-[#0f6872]" : "text-[#102b3f]"}`}>{option}{language === option ? <span aria-hidden="true">✓</span> : null}</button>)}
              </div>
            </div>
          ) : null}

          {step === "voice" ? (
            <div>
              <h2 id="settings-setup-step-title" tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f6872]">Voice settings</h2>
              <p className="mt-2 text-sm leading-6 text-[#667b89]">These preferences take effect as soon as you select them.</p>
              <div className="mt-3 border-y border-[#dce5ea]">
                {currentUser.role === "requester" ? <>
                  <ToggleRow title="Voice navigation" description="Use voice commands to move through the emergency flow hands-free. Microphone access may be requested." checked={requesterVoice.voiceNavigation} onChange={(value) => updateRequesterVoice("voiceNavigation", value)} disabled={finishing} />
                  <ToggleRow title="Voice guidance" description="Hear emergency status and arrival updates." checked={requesterVoice.voiceGuidance} onChange={(value) => updateRequesterVoice("voiceGuidance", value)} disabled={finishing} />
                  <ToggleRow title="Blind voice guidance" description="Speak important emergency details, questions, and unread notifications." checked={requesterVoice.blindVoiceGuidance} onChange={(value) => updateRequesterVoice("blindVoiceGuidance", value)} disabled={finishing} />
                </> : <>
                  <ToggleRow title="Voice navigation" description="Use voice commands to move through mission screens hands-free. Microphone access may be requested." checked={responderVoice.voiceNavigation} onChange={(value) => updateResponderVoice("voiceNavigation", value)} disabled={finishing} />
                  <ToggleRow title="Voice guidance" description="Hear mission status and navigation updates while responding." checked={responderVoice.voiceGuidance} onChange={(value) => updateResponderVoice("voiceGuidance", value)} disabled={finishing} />
                </>}
              </div>
            </div>
          ) : null}

          {step === "display" ? (
            <div>
              <h2 id="settings-setup-step-title" tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f6872]">Display preference</h2>
              <p className="mt-2 text-sm leading-6 text-[#667b89]">Choose the appearance LIVE uses for your account.</p>
              <div className="mt-4 border-y border-[#dce5ea]">
                <ChoiceRow title="Light mode" selected={theme === "light"} onClick={() => void chooseTheme("light")} disabled={finishing} />
                <ChoiceRow title="Dark mode" selected={theme === "dark"} onClick={() => void chooseTheme("dark")} disabled={finishing} />
              </div>
            </div>
          ) : null}
        </section>
        {error ? <p role="alert" className="pb-3 text-center text-sm text-[#a33a38]">{error}</p> : null}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-[#dce5ea] bg-[#f6f8fb]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-3 items-center gap-3 sm:gap-8 sm:px-2">
          <button type="button" disabled={stepIndex === 0 || finishing} onClick={previous} className="min-h-11 justify-self-start rounded-lg border border-[#cbd8de] px-3 text-sm font-semibold text-[#526a78] transition hover:bg-white disabled:opacity-40 sm:px-5">Previous</button>
          <button type="button" disabled={finishing} onClick={() => void finish()} className="min-h-11 justify-self-center px-3 text-sm font-semibold text-[#667b89] underline underline-offset-2 transition hover:text-[#0f6872] disabled:opacity-50">Skip</button>
          <button type="button" disabled={finishing || (step === "vision" && visionAnswer === null)} onClick={next} className="min-h-11 justify-self-end rounded-lg bg-[#0f6872] px-4 text-sm font-bold text-white transition hover:bg-[#0c5962] disabled:cursor-not-allowed disabled:opacity-50 sm:px-6">{stepIndex === steps.length - 1 || (step === "vision" && visionAnswer) ? "Finish" : "Next"}</button>
        </div>
      </footer>
    </div>
  );
}

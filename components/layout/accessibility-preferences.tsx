"use client";

import { Accessibility, Eye, Keyboard, Volume2, VolumeX, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { readRequesterPreferences } from "@/lib/requester-preferences";

type Preferences = {
  brightness: number;
  textScale: number;
  reducedMotion: boolean;
  textSpacing: boolean;
  notificationsMuted: boolean;
  notificationVolume: number;
  notificationSound: "soft" | "alert" | "chime";
};

const storageKey = "live-hci-preferences";
const defaults: Preferences = {
  brightness: 100,
  textScale: 100,
  reducedMotion: false,
  textSpacing: false,
  notificationsMuted: false,
  notificationVolume: 70,
  notificationSound: "soft",
};

function applyPreferences(preferences: Preferences) {
  const root = document.documentElement;
  root.style.setProperty("--live-brightness", String(preferences.brightness / 100));
  root.style.setProperty("--live-font-scale", String(preferences.textScale / 100));
  const brightnessDelta = Math.abs(preferences.brightness - 100) / 100;
  root.style.setProperty("--live-brightness-overlay-color", preferences.brightness < 100 ? "#000" : "#fff");
  root.style.setProperty("--live-brightness-overlay-opacity", String(brightnessDelta));
  root.dataset.liveReducedMotion = String(preferences.reducedMotion);
  root.dataset.liveTextSpacing = String(preferences.textSpacing);
}

export function AccessibilityPreferences({ showFloatingButton = true, hideTriggerButton = false, placement = "floating" }: { showFloatingButton?: boolean; hideTriggerButton?: boolean; placement?: "floating" | "header" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const userStorageKey = `${storageKey}:${user?.id ?? "guest"}`;

  useEffect(() => {
    const openFromVoice = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "open-accessibility") setOpen(true);
    };
    window.addEventListener("live:requester-voice-action", openFromVoice);
    return () => window.removeEventListener("live:requester-voice-action", openFromVoice);
  }, []);

  useEffect(() => {
    if (!open) return;
    const announce = (message: string) => {
      const voice = readRequesterPreferences(user?.id);
      if (!voice.voiceGuidance && !voice.blindVoiceGuidance) return;
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
    };
    const handleVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      const spoken = (detail.transcript ?? "").toLocaleLowerCase().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9% ]/g, " ").replace(/\s+/g, " ").trim();
      if (!spoken) return;

      const close = /^(?:please )?(?:close|dismiss|hide|exit) (?:the )?(?:accessibility|accessibility settings|accessibility preferences|accessibility and notifications|this dialog|this popup|this pop up)$/.test(spoken);
      const brightnessUp = /^(?:please )?(?:increase|raise|boost|brighten|turn up) (?:the )?(?:screen )?brightness$/.test(spoken)
        || /^(?:please )?(?:make (?:the )?(?:screen )?(?:brighter|more bright)|brighter|brightness up)$/.test(spoken);
      const brightnessDown = /^(?:please )?(?:decrease|lower|reduce|dim|turn down) (?:the )?(?:screen )?brightness$/.test(spoken)
        || /^(?:please )?(?:make (?:the )?(?:screen )?(?:dimmer|less bright)|dimmer|brightness down)$/.test(spoken);
      const textUp = /^(?:please )?(?:increase|enlarge|raise) (?:the )?(?:text size|font size|text|font)$/.test(spoken)
        || /^(?:please )?(?:make (?:the )?(?:text|font) (?:bigger|larger)|bigger text|larger text|larger font)$/.test(spoken);
      const textDown = /^(?:please )?(?:decrease|reduce|lower) (?:the )?(?:text size|font size|text|font)$/.test(spoken)
        || /^(?:please )?(?:make (?:the )?(?:text|font) smaller|smaller text|smaller font)$/.test(spoken);
      const setBrightness = spoken.match(/^(?:please )?set (?:the )?(?:screen )?brightness to (50|55|60|65|70|75|80|85|90|95|100|105|110|115|120)(?: percent|%)?$/);
      const setTextSize = spoken.match(/^(?:please )?set (?:the )?(?:text|font) size to (90|95|100|105|110|115|120|125|130)(?: percent|%)?$/);
      if (!close && !brightnessUp && !brightnessDown && !textUp && !textDown && !setBrightness && !setTextSize) return;
      detail.consumed = true;
      if (!detail.isFinal) return;

      if (close) {
        setOpen(false);
        announce("Accessibility settings closed.");
      } else if (brightnessUp || brightnessDown || setBrightness) {
        const value = setBrightness
          ? Number(setBrightness[1])
          : Math.min(120, Math.max(50, preferences.brightness + (brightnessUp ? 10 : -10)));
        update("brightness", value);
        announce(`Screen brightness ${brightnessUp ? "increased" : brightnessDown ? "decreased" : "set to"} ${value} percent.`);
      } else {
        const value = setTextSize
          ? Number(setTextSize[1])
          : Math.min(130, Math.max(90, preferences.textScale + (textUp ? 10 : -10)));
        update("textScale", value);
        announce(`Text size ${textUp ? "increased" : textDown ? "decreased" : "set to"} ${value} percent.`);
      }
    };
    window.addEventListener("live:requester-voice-input", handleVoiceInput);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceInput);
  }, [open, preferences]);

  useEffect(() => {
    setHydratedStorageKey(null);
    try {
      const stored = window.localStorage.getItem(userStorageKey);
      if (stored) setPreferences({ ...defaults, ...JSON.parse(stored) });
      else setPreferences(defaults);
    } catch {
      // Keep defaults when local storage is unavailable.
      setPreferences(defaults);
    }
    setHydratedStorageKey(userStorageKey);
  }, [userStorageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== userStorageKey) return;
    applyPreferences(preferences);
    try {
      window.localStorage.setItem(userStorageKey, JSON.stringify(preferences));
    } catch {
      // Preferences still apply for the current session when storage is unavailable.
    }
  }, [hydratedStorageKey, preferences, userStorageKey]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
    if (key === "reducedMotion") window.dispatchEvent(new CustomEvent("live:reduced-motion-changed", { detail: { reducedMotion: value } }));
  }

  function previewSound() {
    if (preferences.notificationsMuted || preferences.notificationVolume === 0) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = preferences.notificationSound === "chime" ? 880 : preferences.notificationSound === "alert" ? 540 : 660;
    oscillator.type = preferences.notificationSound === "alert" ? "square" : "sine";
    gain.gain.setValueAtTime(preferences.notificationVolume / 100 * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    oscillator.addEventListener("ended", () => void context.close());
  }

  return (
    <>
      {hideTriggerButton ? null : showFloatingButton ? (
        <button type="button" onClick={() => setOpen(true)} aria-label="Open accessibility and notification preferences" aria-expanded={open} className={placement === "header" ? `grid h-16 w-10 shrink-0 place-items-center rounded-none border-x-0 border-t-0 border-b-2 bg-transparent transition hover:bg-[#eef8f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6872] ${open ? "border-b-[#0f6872] text-[#0f6872]" : "border-b-transparent text-[#71838e] hover:text-[#0f6872]"}` : "fixed bottom-20 right-4 z-[60] grid h-12 w-12 place-items-center rounded-full bg-[#102b3f] text-white shadow-lg transition hover:bg-[#0f6872] md:bottom-6 md:right-6"}>
          <Accessibility className="h-5 w-5" />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#0f6872] px-4 text-sm font-bold text-[#0f6872] transition hover:bg-[#eef8f8]">
          <Accessibility className="h-4 w-4" /> Accessibility and notification preferences
        </button>
      )}
      {typeof document !== "undefined" && open ? createPortal(
        <div className="fixed inset-0 z-[100] grid min-h-full place-items-center overflow-y-auto bg-[#071a29]/45 px-4 py-8" role="dialog" aria-modal="true" aria-labelledby="accessibility-preferences-title">
          <div className="my-auto w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#dce5ea] px-5 py-4">
              <div>
                <h2 id="accessibility-preferences-title" className="font-bold text-[#102b3f]">Accessibility and notifications</h2>
                <p className="mt-1 text-xs text-[#71828d]">Applies to your account on this device.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close preferences" className="rounded-full p-2 text-[#667b89] hover:bg-[#eef3f5]"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-5 p-5">
              <Slider label="Screen brightness" value={preferences.brightness} min={50} max={120} step={5} suffix="%" onChange={(value) => update("brightness", value)} />
              <Slider label="Text size" value={preferences.textScale} min={90} max={130} step={5} suffix="%" onChange={(value) => update("textScale", value)} />
              <div className="grid gap-2">
                <Toggle icon={<Keyboard className="h-4 w-4" />} label="Expanded text spacing" checked={preferences.textSpacing} onChange={(value) => update("textSpacing", value)} />
                <Toggle icon={<Eye className="h-4 w-4" />} label="Reduce motion" checked={preferences.reducedMotion} onChange={(value) => update("reducedMotion", value)} />
              </div>
              <div className="border-t border-[#dce5ea] pt-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><Volume2 className="h-4 w-4 text-[#0f6872]" /> Notification sound</div>
                <select value={preferences.notificationSound} disabled={preferences.notificationsMuted} onChange={(event) => update("notificationSound", event.target.value as Preferences["notificationSound"])} className="mt-3 min-h-11 w-full rounded-xl border border-[#ccd9df] bg-white px-3 text-sm disabled:opacity-50">
                  <option value="soft">Soft tone</option><option value="alert">Alert tone</option><option value="chime">Chime</option>
                </select>
                <Slider label="Volume" value={preferences.notificationVolume} min={0} max={100} step={5} suffix="%" onChange={(value) => update("notificationVolume", value)} disabled={preferences.notificationsMuted} />
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => update("notificationsMuted", !preferences.notificationsMuted)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d6e0e5] px-3 text-xs font-bold text-[#102b3f]">{preferences.notificationsMuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}{preferences.notificationsMuted ? "Enable sounds" : "Silence sounds"}</button>
                  <button type="button" onClick={previewSound} disabled={preferences.notificationsMuted || preferences.notificationVolume === 0} className="min-h-10 rounded-xl border border-[#d6e0e5] px-3 text-xs font-bold text-[#0f6872] disabled:opacity-50">Preview sound</button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function Slider({ label, value, min, max, step, suffix, onChange, disabled = false }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className="block"><span className="flex items-center justify-between text-sm font-semibold text-[#102b3f]"><span>{label}</span><output className="text-[#0f6872]">{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="mt-3 h-2 w-full accent-[#0f6872] disabled:opacity-50" /></label>;
}

function Toggle({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e2e8ed] p-3 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#0f6872]" /><span className="text-[#0f6872]">{icon}</span>{label}</label>;
}

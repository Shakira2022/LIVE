"use client";

import { Globe2, Mic, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RequesterProfileContent } from "@/components/requester/profile-content";
import { defaultRequesterPreferences, readRequesterPreferences, saveRequesterPreferences, type RequesterPreferences } from "@/lib/requester-preferences";

function PreferenceRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 border-b border-[#dce5ea] px-4 py-5 last:border-b-0 md:px-0">
      {icon ? <span className="mt-0.5 text-[#0f5b67]">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[#102b3f]">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-[#667b89]">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border text-[8px] font-bold leading-none transition ${
          checked
            ? "justify-start border-[#0f5b67] bg-[#0f5b67] pl-1 text-white"
            : "justify-end border-[#aebfc9] bg-white pr-1 text-[#667b89]"
        }`}
      >
        {checked ? "ON" : "OFF"}
        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition ${checked ? "right-0.5 bg-white" : "left-0.5 bg-[#6e808c]"}`} />
      </span>
    </label>
  );
}

export default function RequesterSettingsPage() {
  const [preferences, setPreferences] = useState<RequesterPreferences>(defaultRequesterPreferences);
  const [section, setSection] = useState<"system" | "request" | "profile">("system");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [language, setLanguage] = useState("English");
  const [languageOpen, setLanguageOpen] = useState(false);

  const languages = [
    "English",
    "Afrikaans",
    "isiZulu",
    "isiXhosa",
    "Sesotho",
    "Setswana",
    "Sepedi",
    "siSwati",
    "Tshivenda",
    "isiNdebele",
    "XiTsonga",
  ];

  useEffect(() => {
    setPreferences(readRequesterPreferences());
    setLanguage(window.localStorage.getItem("live-language") || "English");
    const savedTheme = window.localStorage.getItem("live-display-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
    }
  }, []);

  function update(next: Partial<RequesterPreferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    saveRequesterPreferences(merged);
  }

  function chooseTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    window.localStorage.setItem("live-display-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function chooseLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    window.localStorage.setItem("live-language", nextLanguage);
    setLanguageOpen(false);
  }

  return (
    <div className="app-page !px-0 !pt-0 grid gap-4 md:!px-8">
      <nav className="flex justify-center border-b border-[#dce5ea] bg-white px-4 md:px-0" aria-label="Settings sections">
        <button
          type="button"
          onClick={() => setSection("system")}
          className={`border-b-2 px-3 py-4 text-sm transition ${section === "system" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent font-normal text-[#667b89]"}`}
        >
          System settings
        </button>
        <button
          type="button"
          onClick={() => setSection("request")}
          className={`border-b-2 px-3 py-4 text-sm transition ${section === "request" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent font-normal text-[#667b89]"}`}
        >
          Request settings
        </button>
        <button
          type="button"
          onClick={() => setSection("profile")}
          className={`border-b-2 px-3 py-4 text-sm transition md:hidden ${section === "profile" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent font-normal text-[#667b89]"}`}
        >
          Profile
        </button>
      </nav>

      {section === "system" ? (
        <section className="border-y border-[#dce5ea] bg-transparent">
          <div className="flex items-start gap-4 border-b border-[#dce5ea] px-4 py-5 md:px-0">
            <Sun className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-[#102b3f]">Appearance</h2>
              <p className="mt-1 text-sm leading-6 text-[#667b89]">Choose how LIVE appears on this device.</p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => chooseTheme("light")} className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${theme === "light" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent font-normal text-[#667b89]"}`}>
                  <Sun className="h-4 w-4" /> Light mode
                </button>
                <button type="button" onClick={() => chooseTheme("dark")} className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${theme === "dark" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent font-normal text-[#667b89]"}`}>
                  <Moon className="h-4 w-4" /> Dark mode
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-4 px-4 py-5 md:px-0">
            <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-[#102b3f]">Language</h2>
              <p className="mt-1 text-sm leading-6 text-[#667b89]">Choose the language used by LIVE.</p>
              <button type="button" onClick={() => setLanguageOpen(true)} className="mt-3 border-b-2 border-[#0f6872] px-1 py-1 text-sm font-semibold text-[#0f6872]">
                {language}
              </button>
            </div>
          </div>
        </section>
      ) : section === "request" ? (
        <section className="border-y border-[#dce5ea] bg-transparent px-4 py-5 md:px-0">
          <div className="flex items-start gap-4">
            <Mic className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-[#102b3f]">Voice settings</h2>
              <div className="mt-3 pl-3">
                <PreferenceRow
                  icon={null}
                  title="Voice navigation"
                  description="Use your voice to move through the emergency flow hands-free."
                  checked={preferences.voiceNavigation}
                  onChange={(voiceNavigation) => update({ voiceNavigation })}
                />
                <PreferenceRow
                  icon={null}
                  title="Voice guidance"
                  description="Hear status updates, estimated arrival time, and distance while using request and tracking screens."
                  checked={preferences.voiceGuidance}
                  onChange={(voiceGuidance) => update({ voiceGuidance })}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {section === "profile" ? (
        <RequesterProfileContent />
      ) : null}

      {languageOpen ? (
        <div className="pointer-events-auto fixed inset-0 z-[9999] grid place-items-center bg-[#071a29]/45 px-5" role="dialog" aria-modal="true" aria-labelledby="language-title">
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#dce5ea] px-5 py-4">
              <h2 id="language-title" className="font-semibold text-[#102b3f]">Choose a language</h2>
              <button type="button" onClick={() => setLanguageOpen(false)} aria-label="Close language picker" className="rounded-full p-1 text-[#667b89] hover:bg-[#eef3f5]"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[min(28rem,70vh)] overflow-y-auto divide-y divide-[#dce5ea]">
              {languages.map((option) => (
                <button key={option} type="button" onClick={() => chooseLanguage(option)} className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm ${language === option ? "font-semibold text-[#0f6872]" : "text-[#102b3f]"}`}>
                  {option}
                  {language === option ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

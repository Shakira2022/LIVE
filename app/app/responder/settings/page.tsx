"use client";

import { Globe2, Mic, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeading } from "@/components/ui/page-heading";
import { useAuth } from "@/components/auth/auth-provider";
import { StaffProfileCard } from "@/components/profile/staff-profile-card";
import { regionalDefaultTheme } from "@/lib/display-theme";
import { readRequesterLanguage, saveRequesterLanguage, REQUESTER_LANGUAGES, type RequesterLanguage } from "@/lib/requester-language";
import { DEFAULT_RESPONDER_PREFERENCES, readResponderPreferences, saveResponderPreferences } from "@/lib/responder-preferences";

type ResponderPreferences = typeof DEFAULT_RESPONDER_PREFERENCES;
const defaultPreferences: ResponderPreferences = DEFAULT_RESPONDER_PREFERENCES;

function PreferenceRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-4 border-b border-[#dce5ea] px-4 py-5 last:border-b-0 md:px-0">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[#102b3f]">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-[#667b89]">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`relative mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border text-[8px] font-bold leading-none transition ${checked ? "justify-start border-[#0f5b67] bg-[#0f5b67] pl-1 text-white" : "justify-end border-[#aebfc9] bg-white pr-1 text-[#667b89]"}`}>
        {checked ? "ON" : "OFF"}<span className={`absolute top-0.5 h-4 w-4 rounded-full transition ${checked ? "right-0.5 bg-white" : "left-0.5 bg-[#6e808c]"}`} />
      </span>
    </label>
  );
}

export default function ResponderSettingsPage() {
  const { user, updateDisplayTheme } = useAuth();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<"system" | "mission" | "profile">("system");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeSaveError, setThemeSaveError] = useState("");
  const [language, setLanguage] = useState<RequesterLanguage>(() => user?.id ? readRequesterLanguage(user.id) : "English");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const languages = REQUESTER_LANGUAGES;

  useEffect(() => {
    if (searchParams.get("section") === "profile") setSection("profile");
  }, [searchParams]);

  useEffect(() => {
    if (user?.id) setLanguage(readRequesterLanguage(user.id));
    if (!user?.id) return;
    const syncLanguage = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; language?: string }>).detail;
      if (detail?.userId === user.id && languages.includes(detail.language as RequesterLanguage)) setLanguage(detail.language as RequesterLanguage);
    };
    window.addEventListener("live:language-changed", syncLanguage);
    try {
      setPreferences(readResponderPreferences(user.id));
    } catch {
      setPreferences(defaultPreferences);
    }
    return () => window.removeEventListener("live:language-changed", syncLanguage);
  }, [user?.id]);

  useEffect(() => {
    setTheme(user?.displayTheme ?? regionalDefaultTheme());
  }, [user?.displayTheme]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const nextTheme = (event as CustomEvent<{ theme: "light" | "dark" }>).detail.theme;
      setTheme(nextTheme);
    };
    window.addEventListener("live:display-theme-changed", syncTheme);
    return () => window.removeEventListener("live:display-theme-changed", syncTheme);
  }, []);

  function updatePreferences(next: Partial<ResponderPreferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    saveResponderPreferences(user?.id, merged);
  }

  async function chooseTheme(next: "light" | "dark") {
    setTheme(next);
    setThemeSaving(true);
    setThemeSaveError("");
    const saved = await updateDisplayTheme(next);
    if (!saved) {
      setTheme(user?.displayTheme ?? regionalDefaultTheme());
      setThemeSaveError("Your display preference could not be saved. Try again.");
    }
    setThemeSaving(false);
  }

  function chooseLanguage(next: string) {
    if (!languages.includes(next as typeof languages[number]) || !user?.id) return;
    const selectedLanguage = next as RequesterLanguage;
    setLanguage(selectedLanguage);
    saveRequesterLanguage(user.id, selectedLanguage);
    setLanguageOpen(false);
  }

  return (
    <div className="app-page !px-0 !pt-0 grid gap-4 md:!px-8">
      <div className="hidden sm:block"><PageHeading title="Settings" description="Manage your LIVE workspace and mission preferences." /></div>
      <nav className="sticky top-16 z-30 grid grid-cols-3 border-b border-[#dce5ea] bg-white px-4 shadow-sm md:mx-auto md:w-full md:max-w-4xl md:grid-cols-2 md:px-0" aria-label="Settings sections">
        <button type="button" onClick={() => setSection("system")} className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === "system" ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}>System settings</button>
        <button type="button" onClick={() => setSection("mission")} className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === "mission" ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}>Mission settings</button>
        <button type="button" onClick={() => setSection("profile")} className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition md:hidden ${section === "profile" ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}>Profile</button>
      </nav>

      <AnimatePresence mode="sync" initial={false}>
      {section === "system" ? <motion.section key="system-settings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }} className="border-y border-[#dce5ea] bg-transparent">
        <div className="flex items-start gap-4 border-b border-[#dce5ea] px-4 py-5 md:px-0">
          <Sun className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-[#102b3f]">Appearance</h2>
            <p className="mt-1 text-sm leading-6 text-[#667b89]">Choose how LIVE appears for your account.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={themeSaving} onClick={() => void chooseTheme("light")} className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm disabled:opacity-60 ${theme === "light" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}><Sun className="h-4 w-4" />Light mode</button>
              <button type="button" disabled={themeSaving} onClick={() => void chooseTheme("dark")} className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm disabled:opacity-60 ${theme === "dark" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}><Moon className="h-4 w-4" />Dark mode</button>
            </div>
            {themeSaveError ? <p role="alert" className="mt-2 text-sm text-[#a33a38]">{themeSaveError}</p> : null}
          </div>
        </div>
        <div className="flex items-start gap-4 px-4 py-5 md:px-0">
          <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
          <div className="min-w-0 flex-1"><h2 className="font-semibold text-[#102b3f]">Language</h2><p className="mt-1 text-sm leading-6 text-[#667b89]">Choose the language used by LIVE.</p><button type="button" onClick={() => setLanguageOpen(true)} className="mt-3 border-b-2 border-[#0f6872] px-1 py-1 text-sm font-semibold text-[#0f6872]">{language}</button></div>
        </div>
      </motion.section> : section === "mission" ? <motion.section key="mission-settings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }} className="border-y border-[#dce5ea] bg-transparent">
        <div className="flex items-start gap-4 px-4 py-5 md:px-0"><Mic className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" /><div className="min-w-0 flex-1"><h2 className="font-semibold text-[#102b3f]">Voice guidance</h2><PreferenceRow title="Spoken mission updates" description="Hear when a request is assigned, the incident details and next action, incoming call announcements, and reminders when requests are waiting while you are offline." checked={preferences.voiceGuidance} onChange={(voiceGuidance) => updatePreferences({ voiceGuidance })} /></div></div>
      </motion.section> : null}
      {section === "profile" ? <motion.div key="profile-settings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }}><StaffProfileCard /></motion.div> : null}
      </AnimatePresence>

      {languageOpen ? <div className="fixed inset-0 z-[9999] grid place-items-center bg-[#071a29]/45 px-5" role="dialog" aria-modal="true" aria-labelledby="responder-language-title"><div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#dce5ea] px-5 py-4"><h2 id="responder-language-title" className="font-semibold text-[#102b3f]">Choose a language</h2><button type="button" onClick={() => setLanguageOpen(false)} aria-label="Close language picker" className="rounded-full p-1 text-[#667b89] hover:bg-[#eef3f5]"><X className="h-5 w-5" /></button></div><div className="max-h-[min(28rem,70vh)] overflow-y-auto divide-y divide-[#dce5ea]">{languages.map((option) => <button key={option} type="button" onClick={() => chooseLanguage(option)} className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm ${language === option ? "font-semibold text-[#0f6872]" : "text-[#102b3f]"}`}>{option}{language === option ? <span aria-hidden="true">✓</span> : null}</button>)}</div></div></div> : null}
    </div>
  );
}

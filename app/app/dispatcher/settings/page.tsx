"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { StaffProfileCard } from "@/components/profile/staff-profile-card";
import { PageHeading } from "@/components/ui/page-heading";
import { regionalDefaultTheme } from "@/lib/display-theme";

type DispatcherSettingsSection = "system" | "profile";

export default function DispatcherSettingsPage() {
  const { user, updateDisplayTheme } = useAuth();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<DispatcherSettingsSection>("system");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeSaveError, setThemeSaveError] = useState("");

  useEffect(() => {
    setSection(searchParams.get("section") === "profile" ? "profile" : "system");
  }, [searchParams]);

  useEffect(() => {
    setTheme(user?.displayTheme ?? regionalDefaultTheme());
  }, [user?.displayTheme]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: "light" | "dark" }>).detail;
      if (detail?.theme) setTheme(detail.theme);
    };
    window.addEventListener("live:display-theme-changed", syncTheme);
    return () => window.removeEventListener("live:display-theme-changed", syncTheme);
  }, []);

  async function chooseTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    setThemeSaving(true);
    setThemeSaveError("");
    const saved = await updateDisplayTheme(nextTheme);
    if (!saved) {
      setTheme(user?.displayTheme ?? regionalDefaultTheme());
      setThemeSaveError("Your display preference could not be saved. Try again.");
    }
    setThemeSaving(false);
  }

  return (
    <div className="app-page !px-0 !pt-0 grid gap-4 md:!px-8">
      <div className="hidden sm:block">
        <PageHeading title="Settings" description="Manage your LIVE workspace and account preferences." />
      </div>

      <nav className="sticky top-16 z-30 grid grid-cols-2 border-b border-[#dce5ea] bg-white px-4 shadow-sm md:mx-auto md:w-full md:max-w-4xl md:px-0" aria-label="Settings sections">
        <button
          type="button"
          onClick={() => setSection("system")}
          className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === "system" ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}
        >
          System settings
        </button>
        <button
          type="button"
          onClick={() => setSection("profile")}
          className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === "profile" ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}
        >
          Profile
        </button>
      </nav>

      <AnimatePresence mode="sync" initial={false}>
        {section === "system" ? (
          <motion.section
            key="dispatcher-system-settings"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="border-y border-[#dce5ea] bg-transparent"
          >
            <div className="flex items-start gap-4 px-4 py-5 md:px-0">
              <Sun className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5b67]" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-[#102b3f]">Appearance</h2>
                <p className="mt-1 text-sm leading-6 text-[#667b89]">Choose how LIVE appears for your account.</p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={themeSaving}
                    onClick={() => void chooseTheme("light")}
                    className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm disabled:opacity-60 ${theme === "light" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}
                  >
                    <Sun className="h-4 w-4" />Light mode
                  </button>
                  <button
                    type="button"
                    disabled={themeSaving}
                    onClick={() => void chooseTheme("dark")}
                    className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm disabled:opacity-60 ${theme === "dark" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}
                  >
                    <Moon className="h-4 w-4" />Dark mode
                  </button>
                </div>
                {themeSaveError ? <p role="alert" className="mt-2 text-sm text-[#a33a38]">{themeSaveError}</p> : null}
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="dispatcher-profile-settings"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <StaffProfileCard />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

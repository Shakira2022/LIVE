"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { regionalDefaultTheme } from "@/lib/display-theme";
import type { DisplayTheme } from "@/types";

export function DisplayThemeSettings({ description = "Choose how LIVE appears for your account." }: { description?: string }) {
  const { user, updateDisplayTheme } = useAuth();
  const [theme, setTheme] = useState<DisplayTheme>(user?.displayTheme ?? regionalDefaultTheme());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTheme(user?.displayTheme ?? regionalDefaultTheme());
  }, [user?.displayTheme]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const nextTheme = (event as CustomEvent<{ theme?: DisplayTheme }>).detail?.theme;
      if (nextTheme) setTheme(nextTheme);
    };
    window.addEventListener("live:display-theme-changed", syncTheme);
    return () => window.removeEventListener("live:display-theme-changed", syncTheme);
  }, []);

  async function chooseTheme(nextTheme: DisplayTheme) {
    if (saving || nextTheme === theme) return;
    const previousTheme = theme;
    setTheme(nextTheme);
    setSaving(true);
    setError("");
    const saved = await updateDisplayTheme(nextTheme);
    if (!saved) {
      setTheme(previousTheme);
      setError("Your display preference could not be saved. Try again.");
    }
    setSaving(false);
  }

  return (
    <Panel>
      <PanelHeader title="Appearance" description={description} />
      <div className="flex flex-wrap items-center gap-2 p-4 sm:p-5" aria-busy={saving}>
        <button type="button" disabled={saving} onClick={() => void chooseTheme("light")} aria-pressed={theme === "light"} className={`flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-sm transition disabled:opacity-60 ${theme === "light" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}>
          {saving && theme === "light" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sun className="h-4 w-4" />}
          Light mode
        </button>
        <button type="button" disabled={saving} onClick={() => void chooseTheme("dark")} aria-pressed={theme === "dark"} className={`flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-sm transition disabled:opacity-60 ${theme === "dark" ? "border-[#0f6872] font-bold text-[#0f6872]" : "border-transparent text-[#667b89]"}`}>
          {saving && theme === "dark" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Moon className="h-4 w-4" />}
          Dark mode
        </button>
        {error ? <p role="alert" className="basis-full text-sm text-[#a33a38]">{error}</p> : null}
      </div>
    </Panel>
  );
}

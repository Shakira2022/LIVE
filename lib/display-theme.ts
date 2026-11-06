import type { DisplayTheme } from "@/types";

/** Uses the browser's local time zone, or light when it is unavailable. */
export function regionalDefaultTheme(now = new Date()): DisplayTheme {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return "light";

    const hour = Number(
      new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        hourCycle: "h23",
        timeZone,
      }).format(now),
    );

    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "light";
    return hour >= 18 || hour < 6 ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyDisplayTheme(
  theme: DisplayTheme,
  source: "account" | "default" = "account",
) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeSource = source;
  window.dispatchEvent(new CustomEvent("live:display-theme-changed", {
    detail: { theme, source },
  }));
}

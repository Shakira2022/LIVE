"use client";

import { useEffect } from "react";
import { applyDisplayTheme, regionalDefaultTheme } from "@/lib/display-theme";

export function DisplayThemeInitializer() {
  useEffect(() => {
    // A quick local default is shown while auth loads. AuthProvider replaces
    // it with the account's saved choice before rendering the signed-in app.
    const applyDefaultWhenNeeded = () => {
      if (document.documentElement.dataset.themeSource !== "account") {
        applyDisplayTheme(regionalDefaultTheme(), "default");
      }
    };

    applyDefaultWhenNeeded();
    const timer = window.setInterval(applyDefaultWhenNeeded, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}

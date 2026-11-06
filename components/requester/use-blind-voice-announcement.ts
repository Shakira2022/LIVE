"use client";

import { useEffect, useRef, useState } from "react";

import { readRequesterPreferences } from "@/lib/requester-preferences";
import type { RequesterLanguage } from "@/lib/requester-language";

const SPEECH_LANGUAGE_TAG: Record<RequesterLanguage, string> = {
  English: "en-ZA",
  Afrikaans: "af-ZA",
  isiZulu: "zu-ZA",
  isiXhosa: "xh-ZA",
  Sesotho: "st-ZA",
  Setswana: "tn-ZA",
  Sepedi: "nso-ZA",
  siSwati: "ss-ZA",
  Tshivenda: "ve-ZA",
  isiNdebele: "nr-ZA",
  XiTsonga: "ts-ZA",
};

export const SPOKEN_SKIP_INSTRUCTION: Record<RequesterLanguage, string> = {
  English: "To skip this optional question, say skip.",
  Afrikaans: "Om hierdie opsionele vraag oor te slaan, sê: slaan hierdie vraag oor.",
  isiZulu: "Ukuze weqe lo mbuzo ongaphoqelekile, yithi: yeqa lo mbuzo.",
  isiXhosa: "Ukuze utsibe lo mbuzo unganyanzelekanga, yithi: tsiba lo mbuzo.",
  Sesotho: "Ho tlola potso ena eo e seng tlamo, e re: tlola potso ena.",
  Setswana: "Go tlola potso eno ya boikgethelo, bua o re: tlola potso eno.",
  Sepedi: "Go tlola potšišo yeo o ka e kgethago, re: feta potšišo ye.",
  siSwati: "Kweqa lombuto wekutikhetsela, yisho: yeqa lombuto lo.",
  Tshivenda: "U fhira mbudziso iyi ya u tou nanga, amba u ri: fhirani mbudziso iyi.",
  isiNdebele: "Ukuze weqe umbuzo lo ongakukhetha, yithi: yeqa umbuzo lo.",
  XiTsonga: "Ku tlula xivutiso lexi u nga tihlawulela, vula u ku: tlula xivutiso lexi.",
};

export function useBlindVoiceAnnouncement(
  text: string | null,
  language: RequesterLanguage,
  active = true,
  userId?: string,
) {
  const [enabled, setEnabled] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const sync = () => {
      const nextEnabled = readRequesterPreferences(userId).blindVoiceGuidance;
      setEnabled((currentEnabled) => {
        if (currentEnabled && !nextEnabled && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          utteranceRef.current = null;
        }
        return nextEnabled;
      });
    };
    sync();
    const onPreferenceChange = () => {
      const nextEnabled = readRequesterPreferences(userId).blindVoiceGuidance;
      setEnabled((currentEnabled) => {
        if (currentEnabled && !nextEnabled && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          utteranceRef.current = null;
        }
        return nextEnabled;
      });
    };
    window.addEventListener("storage", sync);
    window.addEventListener("live:requester-preferences-changed", onPreferenceChange);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:requester-preferences-changed", onPreferenceChange);
    };
  }, [userId]);

  useEffect(() => {
    if (!enabled || !active || !text || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANGUAGE_TAG[language];
    utterance.rate = 0.92;
    utteranceRef.current = utterance;
    window.dispatchEvent(new CustomEvent("live:blind-page-instructions", { detail: { text } }));
    utterance.onend = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
    };
    window.speechSynthesis.speak(utterance);

    return () => {
      if (utteranceRef.current === utterance) {
        window.speechSynthesis.cancel();
        utteranceRef.current = null;
      }
    };
  }, [active, enabled, language, text]);
}

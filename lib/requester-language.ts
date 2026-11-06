export const REQUESTER_LANGUAGES = [
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
] as const;

export type RequesterLanguage = (typeof REQUESTER_LANGUAGES)[number];

// The local TranslatePsy model used by LIVE AI explicitly supports English and
// these five app languages. Keep the rest of the app's UI language unchanged;
// only the AI answer target falls back when the translator lacks that language.
const AI_TRANSLATION_LANGUAGES = new Set<RequesterLanguage>([
  "Afrikaans",
  "isiZulu",
  "isiXhosa",
  "Sesotho",
  "Setswana",
]);

export function requesterAiLanguage(language: RequesterLanguage): RequesterLanguage {
  return language === "English" || AI_TRANSLATION_LANGUAGES.has(language) ? language : "English";
}

export function requesterLanguageKey(userId: string) {
  return `live-language:${userId}`;
}

export function readRequesterLanguage(userId: string): RequesterLanguage {
  if (typeof window === "undefined") return "English";
  const value = window.localStorage.getItem(requesterLanguageKey(userId));
  if (REQUESTER_LANGUAGES.includes(value as RequesterLanguage)) return value as RequesterLanguage;
  // Upgrade the old shared setting once, assigning it to the account currently
  // signed in. New account preferences are always stored under that account ID.
  const legacy = window.localStorage.getItem("live-language");
  if (REQUESTER_LANGUAGES.includes(legacy as RequesterLanguage)) {
    window.localStorage.setItem(requesterLanguageKey(userId), legacy!);
    window.localStorage.removeItem("live-language");
    return legacy as RequesterLanguage;
  }
  return "English";
}

export function saveRequesterLanguage(userId: string, language: RequesterLanguage) {
  window.localStorage.setItem(requesterLanguageKey(userId), language);
  window.dispatchEvent(new CustomEvent("live:language-changed", { detail: { userId, language } }));
}

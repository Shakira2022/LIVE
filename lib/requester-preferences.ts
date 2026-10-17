export type RequesterPreferences = {
  voiceGuidance: boolean;
  voiceNavigation: boolean;
  skipIncidentDetails: boolean;
};

const STORAGE_KEY = "live-requester-preferences-v1";

export const defaultRequesterPreferences: RequesterPreferences = {
  voiceGuidance: false,
  voiceNavigation: false,
  skipIncidentDetails: true,
};

export function readRequesterPreferences(): RequesterPreferences {
  if (typeof window === "undefined") return defaultRequesterPreferences;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultRequesterPreferences;
    return { ...defaultRequesterPreferences, ...JSON.parse(stored) };
  } catch {
    return defaultRequesterPreferences;
  }
}

export function saveRequesterPreferences(preferences: RequesterPreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export type ResponderPreferences = { voiceGuidance: boolean };

export const DEFAULT_RESPONDER_PREFERENCES: ResponderPreferences = { voiceGuidance: false };

export function readResponderPreferences(userId?: string | null): ResponderPreferences {
  if (typeof window === "undefined" || !userId) return DEFAULT_RESPONDER_PREFERENCES;
  try {
    const saved = window.localStorage.getItem(`live-responder-preferences:${userId}`);
    return saved ? { ...DEFAULT_RESPONDER_PREFERENCES, ...JSON.parse(saved) } : DEFAULT_RESPONDER_PREFERENCES;
  } catch {
    return DEFAULT_RESPONDER_PREFERENCES;
  }
}

export function saveResponderPreferences(userId: string | null | undefined, preferences: ResponderPreferences) {
  if (typeof window === "undefined" || !userId) return;
  window.localStorage.setItem(`live-responder-preferences:${userId}`, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent("live:responder-preferences-changed", { detail: { userId, preferences } }));
}

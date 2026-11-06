import { authenticatedFetch } from "@/lib/client-api";

export type RequesterPreferences = {
  voiceGuidance: boolean;
  blindVoiceGuidance: boolean;
  voiceNavigation: boolean;
  voiceCommandsActive: boolean;
  skipIncidentDetails: boolean;
};

const STORAGE_PREFIX = "live-requester-preferences-v1:";

export const defaultRequesterPreferences: RequesterPreferences = {
  voiceGuidance: false,
  blindVoiceGuidance: false,
  voiceNavigation: false,
  voiceCommandsActive: true,
  skipIncidentDetails: true,
};

let activeRequesterId: string | null = null;

export function setActiveRequesterPreferenceUser(userId: string | null) {
  activeRequesterId = userId;
}

export function getActiveRequesterPreferenceUser() {
  return activeRequesterId;
}

function storageKey(userId: string | null | undefined) {
  const resolvedUserId = userId === undefined ? activeRequesterId : userId;
  return resolvedUserId ? `${STORAGE_PREFIX}${resolvedUserId}` : null;
}

function writeLocalPreferences(preferences: RequesterPreferences, userId?: string | null) {
  if (typeof window === "undefined") return;
  const key = storageKey(userId);
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(preferences));
}

export function readRequesterPreferences(userId?: string | null): RequesterPreferences {
  if (typeof window === "undefined") return defaultRequesterPreferences;
  const key = storageKey(userId);
  if (!key) return defaultRequesterPreferences;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return defaultRequesterPreferences;
    return { ...defaultRequesterPreferences, ...JSON.parse(stored) };
  } catch {
    return defaultRequesterPreferences;
  }
}

export function saveRequesterPreferences(preferences: RequesterPreferences, userId?: string | null) {
  writeLocalPreferences(preferences, userId);
  if (typeof window === "undefined" || !(userId === undefined ? activeRequesterId : userId)) return;
  void persistRequesterPreferences(preferences).catch(() => {
    // Local preferences stay available offline and can be synced on the next
    // change or login refresh.
  });
}

export async function loadRequesterPreferences(userId: string): Promise<RequesterPreferences> {
  const response = await authenticatedFetch("/api/requester/preferences", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load requester voice preferences.");
  const payload = await response.json() as { data?: { preferences?: Partial<RequesterPreferences> }; preferences?: Partial<RequesterPreferences> };
  const preferences = { ...defaultRequesterPreferences, ...(payload.data?.preferences ?? payload.preferences ?? {}) };
  writeLocalPreferences(preferences, userId);
  return preferences;
}

export async function persistRequesterPreferences(preferences: RequesterPreferences): Promise<boolean> {
  const response = await authenticatedFetch("/api/requester/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(preferences),
  });
  return response.ok;
}

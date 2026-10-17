type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const PREFIX = "live-client-cache:";

/**
 * Short-lived, per-tab cache for non-mutating API responses. It avoids a
 * database read every time a user moves between screens while keeping active
 * request tracking on its own live refresh loop. sessionStorage is used so
 * data does not survive closing the browser tab or leak across browser users.
 */
export function readFreshCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEnvelope<T>;
    if (entry.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(`${PREFIX}${key}`);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

/** Read the last stored value while a fresh API value is fetched in background. */
export function readCached<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEnvelope<T>;
    return entry.value ?? null;
  } catch {
    return null;
  }
}

export function writeFreshCache<T>(key: string, value: T, maxAgeMs: number) {
  if (typeof window === "undefined") return;

  try {
    const entry: CacheEnvelope<T> = { value, expiresAt: Date.now() + maxAgeMs };
    window.sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Storage is an optimisation. Private mode or quota limits must not block
    // an emergency screen from rendering.
  }
}

export function clearClientCache(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    // No-op: see writeFreshCache.
  }
}

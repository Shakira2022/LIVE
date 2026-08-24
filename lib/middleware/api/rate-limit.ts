/**
 * Rate limiting middleware (SRS 7.2).
 *
 * Fixed-window counters held in module memory. This is honest about its
 * limits: a single Next.js process is assumed. Before production this must
 * move to a shared store (Upstash Redis or a Postgres counter table),
 * otherwise each serverless instance keeps its own counter. Recorded in the
 * known-limitations list rather than hidden.
 */

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
  /** What identifies a caller: their IP, their user id, or both. */
  by?: 'ip' | 'user' | 'ip+user';
}

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitVerdict {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Clears a caller's counter, e.g. after a successful sign-in. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Named rules so limits are reviewable in one place. */
export const RATE_LIMITS = {
  login:            { limit: 8,   windowMs: 5 * 60_000, by: 'ip' } as RateLimitRule,
  register:         { limit: 5,   windowMs: 15 * 60_000, by: 'ip' } as RateLimitRule,
  refresh:          { limit: 60,  windowMs: 5 * 60_000, by: 'ip+user' } as RateLimitRule,
  createRequest:    { limit: 5,   windowMs: 10 * 60_000, by: 'user' } as RateLimitRule,
  locationPing:     { limit: 120, windowMs: 60_000, by: 'user' } as RateLimitRule,
  statusChange:     { limit: 60,  windowMs: 60_000, by: 'user' } as RateLimitRule,
  read:             { limit: 300, windowMs: 60_000, by: 'ip+user' } as RateLimitRule,
} as const;

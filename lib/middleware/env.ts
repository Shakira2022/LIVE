/**
 * ENVIRONMENT ACCESS WITH FAIL-FAST VALIDATION  (Block 1 Person 1, Block 2 Person 9)
 *
 * Rules:
 *  - Secrets are read here and nowhere else.
 *  - Only NEXT_PUBLIC_* values may be referenced from a client component.
 *  - Property access is written out literally so the Next.js compiler can
 *    inline values for the Edge runtime.
 *
 * Ported from emergency-response/src/lib/env.ts.
 * CHANGED FOR LIVE: this project already publishes NEXT_PUBLIC_SUPABASE_URL,
 * so the Supabase URL is read from that name first and falls back to
 * SUPABASE_URL. Do NOT rename the variable in .env.local - lib/supabase.ts and
 * lib/supabase-server.ts already depend on it.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Values needed by the Edge runtime (root middleware.ts). Keep this tiny. */
export const edgeEnv = {
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtIssuer: process.env.JWT_ISSUER ?? 'live-response-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'live-response-web',
};

/** Node-runtime server values. Never import this from a client component. */
export const serverEnv = {
  get supabaseUrl() {
    return required(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    );
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get jwtSecret() {
    const secret = required('JWT_SECRET', process.env.JWT_SECRET);
    if (secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48',
      );
    }
    return secret;
  },
  jwtIssuer: process.env.JWT_ISSUER ?? 'live-response-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'live-response-web',
  accessTokenTtl: num(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
  refreshTokenTtl: num(process.env.REFRESH_TOKEN_TTL_SECONDS, 604800),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  isProduction: process.env.NODE_ENV === 'production',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== '0',
  /**
   * Whether auth cookies may be sent over plain http.
   *
   * PRODUCTION: always false. Cookies are Secure, no opt-out.
   *
   * DEVELOPMENT: true by DEFAULT. This is deliberate. A Secure cookie is
   * silently discarded by the browser on http://localhost - no error, no
   * warning - which presents as "login said it worked but I'm still signed
   * out". Making the safe-looking default the broken one costs every new
   * teammate an afternoon. Set ALLOW_INSECURE_COOKIES=0 to force Secure in
   * development, e.g. when testing through an https tunnel.
   */
  allowInsecureCookies:
    process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_COOKIES !== '0',
};

/** Browser-safe values. */
export const publicEnv = {
  mapProvider: process.env.NEXT_PUBLIC_MAP_PROVIDER ?? 'osm',
  routeLinkProvider: process.env.NEXT_PUBLIC_ROUTE_LINK_PROVIDER ?? 'google',
  trackingMinIntervalMs: num(process.env.NEXT_PUBLIC_TRACKING_MIN_INTERVAL_MS, 8000),
  trackingMinDistanceM: num(process.env.NEXT_PUBLIC_TRACKING_MIN_DISTANCE_M, 15),
  pollIntervalMs: num(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS, 5000),
};

/**
 * Startup guard (Block 2, Person 9: "validate all .env vars exist on startup").
 * Call this from instrumentation.ts so a misconfigured deploy fails loudly on
 * boot instead of silently 500-ing on the first login attempt.
 */
export function assertServerEnv(): void {
  const problems: string[] = [];
  const checks: Array<[string, () => unknown]> = [
    ['NEXT_PUBLIC_SUPABASE_URL', () => serverEnv.supabaseUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', () => serverEnv.supabaseServiceRoleKey],
    ['JWT_SECRET', () => serverEnv.jwtSecret],
  ];
  for (const [name, read] of checks) {
    try {
      read();
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `${name} is invalid.`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Environment is not usable:\n  - ${problems.join('\n  - ')}`);
  }
}

export const COOKIE_ACCESS = 'live_access';
export const COOKIE_REFRESH = 'live_refresh';
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_USER_ID = 'x-live-user-id';
export const HEADER_USER_ROLE = 'x-live-user-role';

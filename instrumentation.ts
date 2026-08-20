/**
 * STARTUP ENVIRONMENT GUARD   (Block 2, Person 9)
 *
 * Next.js calls register() once, before the first request is served. Validating
 * here means a deploy with a missing JWT_SECRET fails loudly on boot instead of
 * quietly 500-ing on the first login attempt during the demo.
 *
 * In development it WARNS rather than throwing, so a teammate who has not yet
 * copied .env.example can still run the app while they set it up. In production
 * a missing secret is fatal - that is the whole point.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertServerEnv } = await import('@/lib/middleware/env');

  try {
    assertServerEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (process.env.NODE_ENV === 'production') throw error;

    console.warn(
      `\n[middleware] Environment is incomplete - running in degraded mode.\n${message}\n` +
        `Copy .env.example to .env.local and fill it in. See docs/MIDDLEWARE_INTEGRATION_PLAN.md\n`,
    );
  }
}

/**
 * /api/auth/refresh   (Block 2, Persons 6 and 8)
 *
 * POST - called by the client when a request came back TOKEN_EXPIRED.
 * GET  - called by the ROOT MIDDLEWARE as a redirect target when a page
 *        request arrives with an expired access token but a live refresh
 *        cookie. It renews and bounces the user back to ?next=, so a session
 *        does not drop mid-emergency.
 *
 * The refresh token is ROTATED on every use: the old jti is revoked the moment
 * a new one is issued, so a replayed refresh token fails.
 */

import { NextResponse } from 'next/server';
import { createHandler } from '@/lib/middleware/api/handler';
import { clearAuthCookies, setAuthCookies } from '@/lib/middleware/api/cookies';
import { writeSecurityEvent } from '@/lib/middleware/api/audit';
import { jsonOk } from '@/lib/middleware/api/response';
import { COOKIE_REFRESH } from '@/lib/middleware/env';
import { ApiError } from '@/lib/middleware/errors';
import { tokenError, verifyRefreshToken } from '@/lib/middleware/jwt';
import { jwtSettings, rotateSession, toPublicUser } from '@/lib/middleware/server/auth-service';
import type { SessionResponse } from '@/types';

export const runtime = 'nodejs';

/** Only same-origin relative paths, so ?next= cannot be used as an open redirect. */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

async function renew(ctx: {
  req: Request;
  requestId: string;
  ipHash: string;
  userAgent: string;
}): Promise<{
  session: Awaited<ReturnType<typeof rotateSession>>['session'];
  payload: SessionResponse;
}> {
  const cookieHeader = ctx.req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_REFRESH}=([^;]+)`));
  const refreshToken = match?.[1];

  if (!refreshToken) throw ApiError.unauthenticated('Sign in to continue.');

  const outcome = await verifyRefreshToken(jwtSettings(), refreshToken);
  if (!outcome.valid) throw tokenError(outcome.reason);

  const { user, session } = await rotateSession(outcome.claims.jti, {
    userAgent: ctx.userAgent,
    ipHash: ctx.ipHash,
  });

  await writeSecurityEvent({
    action: 'auth.token.refreshed',
    actorId: user.id,
    actorRole: user.role,
    targetType: 'session',
    targetId: session.sessionId,
    result: 'success',
    correlationId: ctx.requestId,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  });

  return {
    session,
    payload: { user: await toPublicUser(user), accessExpiresAt: session.accessExpiresAt },
  };
}

export const POST = createHandler(
  {
    name: 'auth.refresh',
    auth: 'none',
    rateLimit: { limit: 30, windowMs: 5 * 60_000, by: 'ip' },
  },
  async (ctx) => {
    const { session, payload } = await renew(ctx);
    return setAuthCookies(jsonOk(payload, ctx.requestId), {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  },
);

export const GET = createHandler(
  {
    name: 'auth.refresh.redirect',
    auth: 'none',
    rateLimit: { limit: 30, windowMs: 5 * 60_000, by: 'ip' },
  },
  async (ctx) => {
    const next = safeNext(new URL(ctx.req.url).searchParams.get('next')) ?? '/app';

    try {
      const { session } = await renew(ctx);
      return setAuthCookies(NextResponse.redirect(new URL(next, ctx.req.url)), {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
    } catch {
      // The refresh cookie is dead. Clear it and send the user to sign in
      // rather than looping between the guard and this route.
      const login = new URL('/login', ctx.req.url);
      login.searchParams.set('next', next);
      login.searchParams.set('reason', 'session_expired');
      return clearAuthCookies(NextResponse.redirect(login));
    }
  },
);

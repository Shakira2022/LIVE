/**
 * Auth cookie handling.
 *
 * Tokens live in httpOnly cookies so page navigation is authenticated without
 * any JavaScript, and a cross-site script cannot read them. The same tokens
 * are also accepted in an Authorization header, which keeps Postman and the
 * automated tests simple.
 *
 * Both cookies use path '/' because the Edge middleware needs to see the
 * refresh cookie on a page request in order to renew an expired access token
 * without bouncing the user back to the sign-in screen.
 */

import type { NextResponse } from 'next/server';
import { COOKIE_ACCESS, COOKIE_REFRESH, serverEnv } from '@/lib/middleware/env';

function baseOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    // Secure is forced on in production. In development it is off by default
    // so the app works on http://localhost with no .env.local tuning at all -
    // see serverEnv.allowInsecureCookies for why that default is inverted.
    secure: !serverEnv.allowInsecureCookies,
  };
}

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): NextResponse {
  res.cookies.set(COOKIE_ACCESS, tokens.accessToken, {
    ...baseOptions(),
    maxAge: serverEnv.accessTokenTtl,
  });
  res.cookies.set(COOKIE_REFRESH, tokens.refreshToken, {
    ...baseOptions(),
    maxAge: serverEnv.refreshTokenTtl,
  });
  return res;
}

export function clearAuthCookies(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_ACCESS, '', { ...baseOptions(), maxAge: 0 });
  res.cookies.set(COOKIE_REFRESH, '', { ...baseOptions(), maxAge: 0 });
  return res;
}

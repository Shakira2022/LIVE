/**
 * ROOT EDGE MIDDLEWARE  (Block 1 Person 5, Block 2 Persons 6 and 7)
 *
 * This runs before every matched request, on the Edge runtime, and is the
 * first of the TWO middleware layers in this application:
 *
 *   Layer 1 (this file)  - page guards, security headers, correlation ids.
 *                          Edge runtime. No database access, no bcrypt.
 *   Layer 2 (createHandler in lib/middleware/api/handler.ts) - per-endpoint
 *                          auth, roles, validation, rate limiting, audit. Node.
 *
 * Layer 1 exists so an unauthenticated visitor never renders a protected page
 * shell at all. It is a redirect layer, NOT the security boundary: every API
 * route re-verifies the token itself, because a page guard can be bypassed by
 * calling the API directly.
 *
 * Ported from emergency-response/middleware.ts.
 * CHANGED FOR LIVE:
 *   - PAGE_GUARDS rewritten for this app's actual route tree
 *     (/app/requester, /app/dispatcher, /app/responder, /app/admin, /app/auditor)
 *     instead of emergency-response's /app, /dispatch, /admin.
 *   - /forgot-password added to PUBLIC_PAGES.
 *   - CSP connect-src allows the Supabase project origin, because the existing
 *     client code in lib/supabase.ts talks to Supabase directly from the browser.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  HEADER_REQUEST_ID,
  HEADER_USER_ID,
  HEADER_USER_ROLE,
} from '@/lib/middleware/env';
import type { UserRole } from '@/types';

const STAFF: UserRole[] = ['responder', 'dispatcher', 'admin'];
const EVERYONE: UserRole[] = [
  'requester',
  'responder',
  'dispatcher',
  'admin',
  'auditor',
  'support',
];

/** Route prefix -> roles allowed to render it. Longest prefix wins. */
const PAGE_GUARDS: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: '/app/requester', roles: ['requester', 'admin'] },
  { prefix: '/app/dispatcher', roles: ['dispatcher', 'admin'] },
  { prefix: '/app/responder', roles: ['responder', 'dispatcher', 'admin'] },
  { prefix: '/app/admin', roles: ['admin'] },
  { prefix: '/app/auditor', roles: ['auditor', 'admin'] },
  { prefix: '/app', roles: EVERYONE },
];

const PUBLIC_PAGES = ['/', '/login', '/register', '/forgot-password'];

/** Where each role lands after signing in, or after being turned away. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'dispatcher':
      return '/app/dispatcher';
    case 'responder':
      return '/app/responder';
    case 'admin':
      return '/app/admin';
    case 'auditor':
      return '/app/auditor';
    default:
      return '/app/requester';
  }
}

function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function securityHeaders(res: NextResponse, requestId: string, isDev: boolean): NextResponse {
  res.headers.set(HEADER_REQUEST_ID, requestId);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-DNS-Prefetch-Control', 'off');
  // Geolocation is granted to this origin only. Everything else is off.
  res.headers.set(
    'Permissions-Policy',
    'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  );
  if (!isDev) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const supabase = supabaseOrigin();
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Known limitation: Next.js hydration needs inline scripts. Production
      // hardening should move to a per-request nonce.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.openstreetmap.org",
      "frame-src https://www.openstreetmap.org",
      `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace('https://', 'wss://')}` : ''}`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  return res;
}

async function readRole(token: string): Promise<{ userId: string; role: UserRole } | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: process.env.JWT_ISSUER ?? 'live-response-api',
      audience: process.env.JWT_AUDIENCE ?? 'live-response-web',
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    if (payload.typ !== 'access' || !payload.sub) return null;
    return { userId: payload.sub, role: payload.role as UserRole };
  } catch {
    return null;
  }
}

/**
 * KILL SWITCH.
 *
 * Page guards only engage once JWT_SECRET is configured. Until then this file
 * applies security headers and a correlation id but does not redirect anyone,
 * so dropping it into a branch that still uses the old localStorage session
 * cannot lock the team out of their own app. Delete this constant once Block 2
 * is merged and every environment has a secret.
 */
const GUARDS_ENABLED = Boolean(process.env.JWT_SECRET);

export async function middleware(req: NextRequest) {
  const requestId = req.headers.get(HEADER_REQUEST_ID) ?? crypto.randomUUID();
  const isDev = process.env.NODE_ENV !== 'production';
  const { pathname, search } = req.nextUrl;

  if (!GUARDS_ENABLED) {
    const headers = new Headers(req.headers);
    headers.set(HEADER_REQUEST_ID, requestId);
    return securityHeaders(NextResponse.next({ request: { headers } }), requestId, isDev);
  }

  // API routes carry their own middleware chain. Add tracing + headers only,
  // and let createHandler return a JSON 401 rather than an HTML redirect.
  if (pathname.startsWith('/api')) {
    const headers = new Headers(req.headers);
    headers.set(HEADER_REQUEST_ID, requestId);
    return securityHeaders(NextResponse.next({ request: { headers } }), requestId, isDev);
  }

  const guard = PAGE_GUARDS.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
  );

  if (!guard) {
    const res = NextResponse.next();
    // Signed-in visitors should not sit on the sign-in screen.
    if (PUBLIC_PAGES.includes(pathname)) {
      const token = req.cookies.get(COOKIE_ACCESS)?.value;
      const claims = token ? await readRole(token) : null;
      if (claims && (pathname === '/login' || pathname === '/register')) {
        return securityHeaders(
          NextResponse.redirect(new URL(homeFor(claims.role), req.url)),
          requestId,
          isDev,
        );
      }
    }
    return securityHeaders(res, requestId, isDev);
  }

  const accessToken = req.cookies.get(COOKIE_ACCESS)?.value;
  const claims = accessToken ? await readRole(accessToken) : null;

  if (!claims) {
    // A valid refresh cookie means the session is alive but the short-lived
    // access token has expired. Renew it server-side and come straight back
    // instead of making the user sign in again mid-emergency.
    if (req.cookies.get(COOKIE_REFRESH)?.value) {
      const renew = new URL('/api/auth/refresh', req.url);
      renew.searchParams.set('next', `${pathname}${search}`);
      return securityHeaders(NextResponse.redirect(renew), requestId, isDev);
    }
    const login = new URL('/login', req.url);
    login.searchParams.set('next', `${pathname}${search}`);
    login.searchParams.set('reason', 'signin_required');
    return securityHeaders(NextResponse.redirect(login), requestId, isDev);
  }

  if (!guard.roles.includes(claims.role)) {
    const url = new URL(homeFor(claims.role), req.url);
    url.searchParams.set('notice', 'no_access');
    return securityHeaders(NextResponse.redirect(url), requestId, isDev);
  }

  // Forward identity to server components so they do not re-parse the token.
  const headers = new Headers(req.headers);
  headers.set(HEADER_REQUEST_ID, requestId);
  headers.set(HEADER_USER_ID, claims.userId);
  headers.set(HEADER_USER_ROLE, claims.role);
  return securityHeaders(NextResponse.next({ request: { headers } }), requestId, isDev);
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)',
  ],
};

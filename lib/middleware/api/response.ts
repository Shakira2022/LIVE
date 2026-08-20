/**
 * Uniform response envelope (SRS 9.2: "Endpoints must return consistent
 * success and error formats").
 */

import { NextResponse } from 'next/server';
import type { ApiFailure, ApiSuccess } from '@/types';
import { HEADER_REQUEST_ID } from '@/lib/middleware/env';

/**
 * Security headers applied to every API response (SRS 7.2 "Security headers").
 * The page-level CSP is applied in the root middleware.
 */
export function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  // API payloads carry emergency data: never store them in a shared cache.
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}

export function jsonOk<T>(data: T, requestId: string, init?: ResponseInit): NextResponse {
  const body: ApiSuccess<T> = { ok: true, data, requestId };
  const res = NextResponse.json(body, init);
  res.headers.set(HEADER_REQUEST_ID, requestId);
  return applySecurityHeaders(res);
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): NextResponse {
  const body: ApiFailure = { ok: false, error: { code, message, details }, requestId };
  const res = NextResponse.json(body, { status });
  res.headers.set(HEADER_REQUEST_ID, requestId);
  return applySecurityHeaders(res);
}

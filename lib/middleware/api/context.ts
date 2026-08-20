/**
 * Request context middleware (SRS 7.2 "Request tracing").
 *
 * Every server operation gets a correlation id. It travels through the log
 * lines, the audit row and the response body/header so a single emergency can
 * be reconstructed end to end.
 */

import type { NextRequest } from 'next/server';
import { HEADER_REQUEST_ID } from '@/lib/middleware/env';

export function resolveRequestId(req: NextRequest): string {
  const inbound = req.headers.get(HEADER_REQUEST_ID);
  if (inbound && /^[A-Za-z0-9_-]{8,64}$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

/** Best-effort client IP behind Vercel / ngrok / a local proxy. */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

/**
 * IP addresses are personal data (SRS 8.3 data minimisation), so logs store a
 * salted digest instead of the address itself. Same IP -> same hash, which is
 * all rate limiting and abuse review need.
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function userAgent(req: NextRequest): string {
  return (req.headers.get('user-agent') ?? 'unknown').slice(0, 300);
}

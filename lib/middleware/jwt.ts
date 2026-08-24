/**
 * JWT creation and verification (SRS 7.1).
 *
 * Uses `jose` because it runs in BOTH the Node runtime (API route handlers)
 * and the Edge runtime (root middleware.ts). `jsonwebtoken` would work only in
 * Node and the page guard in middleware.ts would have to be dropped.
 *
 * Access token  - short lived, carries role + organisation, sent on every call.
 * Refresh token - long lived, carries only sub + jti, checked against
 *                 devices_sessions so it can be revoked on sign-out.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AccessTokenClaims, RefreshTokenClaims, UserRole } from '@/types';
import { ApiError } from '@/lib/middleware/errors';

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function randomId(): string {
  return crypto.randomUUID();
}

export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
}

export async function signAccessToken(
  config: JwtConfig,
  input: { userId: string; role: UserRole; organisationId: string | null; ttlSeconds: number },
): Promise<{ token: string; tokenId: string; expiresAt: number }> {
  const tokenId = randomId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + input.ttlSeconds;

  const token = await new SignJWT({
    role: input.role,
    org: input.organisationId,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setJti(tokenId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(secretKey(config.secret));

  return { token, tokenId, expiresAt };
}

export async function signRefreshToken(
  config: JwtConfig,
  input: { userId: string; ttlSeconds: number },
): Promise<{ token: string; tokenId: string; expiresAt: number }> {
  const tokenId = randomId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + input.ttlSeconds;

  const token = await new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setJti(tokenId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(secretKey(config.secret));

  return { token, tokenId, expiresAt };
}

type VerifyOutcome<T> =
  | { valid: true; claims: T }
  | { valid: false; reason: 'expired' | 'invalid' | 'wrong_type' };

async function verify(config: JwtConfig, token: string): Promise<JWTPayload | 'expired' | 'invalid'> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config.secret), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    return payload;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'ERR_JWT_EXPIRED' ? 'expired' : 'invalid';
  }
}

export async function verifyAccessToken(
  config: JwtConfig,
  token: string,
): Promise<VerifyOutcome<AccessTokenClaims>> {
  const payload = await verify(config, token);
  if (payload === 'expired') return { valid: false, reason: 'expired' };
  if (payload === 'invalid') return { valid: false, reason: 'invalid' };
  if (payload.typ !== 'access') return { valid: false, reason: 'wrong_type' };
  if (!payload.sub || !payload.jti) return { valid: false, reason: 'invalid' };
  return { valid: true, claims: payload as unknown as AccessTokenClaims };
}

export async function verifyRefreshToken(
  config: JwtConfig,
  token: string,
): Promise<VerifyOutcome<RefreshTokenClaims>> {
  const payload = await verify(config, token);
  if (payload === 'expired') return { valid: false, reason: 'expired' };
  if (payload === 'invalid') return { valid: false, reason: 'invalid' };
  if (payload.typ !== 'refresh') return { valid: false, reason: 'wrong_type' };
  if (!payload.sub || !payload.jti) return { valid: false, reason: 'invalid' };
  return { valid: true, claims: payload as unknown as RefreshTokenClaims };
}

/** Maps a verification failure onto the correct client-facing error. */
export function tokenError(reason: 'expired' | 'invalid' | 'wrong_type'): ApiError {
  if (reason === 'expired') {
    return new ApiError('TOKEN_EXPIRED', 'Your session expired. Sign in again.');
  }
  return new ApiError('TOKEN_INVALID', 'Your session is not valid. Sign in again.');
}

/** Reads a bearer token from the Authorization header, if present. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

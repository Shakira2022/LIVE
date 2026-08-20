/**
 * SESSION SERVICE  (Block 2: Persons 6, 7, 8, 9)
 *
 * Issuing a session does three things together:
 *   - sign a short-lived access token carrying role + organisation,
 *   - sign a long-lived refresh token carrying only sub + jti,
 *   - record a HASH of the refresh jti in device_sessions so it can be revoked.
 *
 * Revocation is what makes sign-out real. A stateless JWT cannot be withdrawn,
 * so the stored jti hash is checked against the table on every renewal.
 *
 * Ported from emergency-response/src/lib/server/auth-service.ts.
 * CHANGED FOR LIVE - schema reconciliation against supabase/schema.sql:
 *   devices_sessions  -> device_sessions
 *   token_id          -> jwt_id_hash (hashed, not stored raw) + refresh_token_hash
 *   device_label      -> device_name; ip_hash -> device_identifier_hash
 *   last_seen_at      -> last_activity_at; revoked_reason -> revocation_reason
 *   users.full_name   -> first_name / last_name / display_name
 *   users.failed_login_count -> failed_login_attempts
 *   users.organisation_id    -> resolved via organisation_members
 *   users.emergency_contact_* -> emergency_contacts table
 *   users.status 'active'|'suspended'|'deleted'
 *                     -> 'pending'|'active'|'suspended'|'locked'|'deactivated'
 *   soft delete: every user lookup must filter .is('deleted_at', null)
 */

import 'server-only';
import { db } from '@/lib/middleware/server/db';
import { serverEnv } from '@/lib/middleware/env';
import { signAccessToken, signRefreshToken, type JwtConfig } from '@/lib/middleware/jwt';
import { ApiError } from '@/lib/middleware/errors';
import type { AccountStatus, PublicUser, UserRole } from '@/types';

const USER_COLUMNS =
  'id, email, phone, password_hash, role, status, first_name, last_name, display_name, ' +
  'failed_login_attempts, locked_until, last_login_at, created_at, deleted_at';

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  role: UserRole;
  status: AccountStatus;
  first_name: string;
  last_name: string;
  display_name: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

export function jwtSettings(): JwtConfig {
  return {
    secret: serverEnv.jwtSecret,
    issuer: serverEnv.jwtIssuer,
    audience: serverEnv.jwtAudience,
  };
}

/* -------------------------------------------------------------------------- */
/* Hashing helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * device_sessions stores jwt_id_hash / refresh_token_hash, not the raw values.
 * A stolen database dump must not yield usable refresh tokens.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* -------------------------------------------------------------------------- */
/* User lookup and shaping                                                     */
/* -------------------------------------------------------------------------- */

function fullNameOf(row: UserRow): string {
  return row.display_name?.trim() || `${row.first_name} ${row.last_name}`.trim();
}

function initialsOf(row: UserRow): string {
  return `${row.first_name?.[0] ?? ''}${row.last_name?.[0] ?? ''}`.toUpperCase() || '??';
}

/**
 * Staff belong to an organisation through organisation_members, not through a
 * column on users. This is the single place that resolves it, so the JWT `org`
 * claim and the API responses can never disagree.
 */
export async function resolveOrganisation(
  userId: string,
): Promise<{ organisationId: string | null; organisationName: string | null }> {
  const { data, error } = await db()
    .from('organisation_members')
    .select('organisation_id, organisations(name)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error || !data) return { organisationId: null, organisationName: null };

  // PostgREST returns an embedded one-to-one as an object, but the generated
  // types describe it as an array, so normalise both shapes here.
  const row = data as unknown as {
    organisation_id: string;
    organisations: { name: string } | { name: string }[] | null;
  };
  const org = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
  return {
    organisationId: row.organisation_id,
    organisationName: org?.name ?? null,
  };
}

async function primaryEmergencyContact(
  userId: string,
): Promise<{ name: string | null; phone: string | null }> {
  const { data } = await db()
    .from('emergency_contacts')
    .select('full_name, phone, is_primary')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { full_name: string; phone: string } | null;
  return { name: row?.full_name ?? null, phone: row?.phone ?? null };
}

export async function toPublicUser(row: UserRow): Promise<PublicUser> {
  const [{ organisationId, organisationName }, contact] = await Promise.all([
    resolveOrganisation(row.id),
    primaryEmergencyContact(row.id),
  ]);

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: fullNameOf(row),
    initials: initialsOf(row),
    role: row.role,
    status: row.status,
    organisationId,
    organisationName,
    emergencyContactName: contact.name,
    emergencyContactPhone: contact.phone,
    createdAt: row.created_at,
  };
}

/** Looks a user up by email or phone. Returns null rather than throwing. */
export async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const value = identifier.trim();
  const column = value.includes('@') ? 'email' : 'phone';
  const lookup = column === 'email' ? value.toLowerCase() : value;

  const { data, error } = await db()
    .from('users')
    .select(USER_COLUMNS)
    .eq(column, lookup)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw ApiError.internal('Could not look up that account.', error.message);
  return (data as UserRow | null) ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw ApiError.internal('Could not load that account.', error.message);
  return (data as UserRow | null) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  sessionId: string;
}

export async function issueSession(
  user: UserRow,
  meta: { userAgent: string; ipHash: string; deviceLabel?: string },
): Promise<IssuedSession> {
  const config = jwtSettings();
  const { organisationId } = await resolveOrganisation(user.id);

  const access = await signAccessToken(config, {
    userId: user.id,
    role: user.role,
    organisationId,
    ttlSeconds: serverEnv.accessTokenTtl,
  });

  const refresh = await signRefreshToken(config, {
    userId: user.id,
    ttlSeconds: serverEnv.refreshTokenTtl,
  });

  const { data, error } = await db()
    .from('device_sessions')
    .insert({
      user_id: user.id,
      device_identifier_hash: meta.ipHash,
      device_name: meta.deviceLabel ?? null,
      user_agent: meta.userAgent,
      jwt_id_hash: await sha256Hex(refresh.tokenId),
      refresh_token_hash: await sha256Hex(refresh.token),
      expires_at: new Date(refresh.expiresAt * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error) throw ApiError.internal('Could not start a session.', error.message);

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
    sessionId: (data as { id: string }).id,
  };
}

/** Confirms a refresh jti is still live, then rotates it. */
export async function rotateSession(
  tokenId: string,
  meta: { userAgent: string; ipHash: string },
): Promise<{ user: UserRow; session: IssuedSession }> {
  const jtiHash = await sha256Hex(tokenId);

  const { data, error } = await db()
    .from('device_sessions')
    .select('id, user_id, revoked_at, expires_at')
    .eq('jwt_id_hash', jtiHash)
    .maybeSingle();

  if (error) throw ApiError.internal('Could not check that session.', error.message);
  if (!data) {
    throw new ApiError('TOKEN_INVALID', 'This session is no longer recognised. Sign in again.');
  }

  const row = data as {
    id: string;
    user_id: string;
    revoked_at: string | null;
    expires_at: string;
  };

  if (row.revoked_at) {
    throw new ApiError('TOKEN_INVALID', 'This session was signed out. Sign in again.');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new ApiError('TOKEN_EXPIRED', 'Your session expired. Sign in again.');
  }

  const user = await findUserById(row.user_id);
  if (!user || user.status !== 'active') {
    throw new ApiError('TOKEN_INVALID', 'This account can no longer sign in.');
  }

  // Rotate: the old refresh token stops working the moment a new one is issued.
  await revokeSession(tokenId, 'rotated');
  const session = await issueSession(user, meta);
  return { user, session };
}

export async function revokeSession(tokenId: string, reason: string): Promise<void> {
  const jtiHash = await sha256Hex(tokenId);
  const { error } = await db()
    .from('device_sessions')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('jwt_id_hash', jtiHash)
    .is('revoked_at', null);

  if (error) throw ApiError.internal('Could not end that session.', error.message);
}

export async function revokeAllSessions(userId: string, reason: string): Promise<void> {
  await db()
    .from('device_sessions')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('user_id', userId)
    .is('revoked_at', null);
}

export async function touchSession(tokenId: string): Promise<void> {
  const jtiHash = await sha256Hex(tokenId);
  await db()
    .from('device_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('jwt_id_hash', jtiHash);
}

/* -------------------------------------------------------------------------- */
/* Lockout (Block 2, Person 7)                                                 */
/* -------------------------------------------------------------------------- */

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export function isLocked(user: UserRow): boolean {
  return Boolean(user.locked_until && new Date(user.locked_until).getTime() > Date.now());
}

/** Only 'active' accounts may sign in - 'pending' has not verified yet. */
export function canSignIn(user: UserRow): boolean {
  return user.status === 'active' && !user.deleted_at;
}

export async function recordFailedLogin(user: UserRow): Promise<void> {
  const count = user.failed_login_attempts + 1;
  const patch: Record<string, unknown> = { failed_login_attempts: count };
  if (count >= MAX_FAILED_LOGINS) {
    patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    patch.failed_login_attempts = 0;
    patch.status = 'locked';
  }
  await db().from('users').update(patch).eq('id', user.id);
}

export async function recordSuccessfulLogin(user: UserRow): Promise<void> {
  await db()
    .from('users')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', user.id);
}

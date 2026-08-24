/**
 * POST /api/auth/register   (Block 2, Persons 6 and 9)
 *
 * Replaces app/api/register/route.ts. Same request body, so the existing
 * register page keeps working, but:
 *   - password strength is enforced server-side (validation.ts),
 *   - the emergency contact goes into the emergency_contacts table rather than
 *     being dropped on the floor as it is today,
 *   - a session is issued immediately, so the user is signed in after signup,
 *   - the duplicate email/phone checks become one unique-violation catch
 *     instead of two extra round trips that race.
 *
 * NOTE for Block 8: the old path /api/register should 308-redirect here for one
 * release rather than being deleted outright, in case anything still posts to it.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { setAuthCookies } from '@/lib/middleware/api/cookies';
import { writeSecurityEvent } from '@/lib/middleware/api/audit';
import { jsonOk } from '@/lib/middleware/api/response';
import { ApiError } from '@/lib/middleware/errors';
import { registerSchema } from '@/lib/middleware/validation';
import { hashPassword } from '@/lib/middleware/password';
import { db, isUniqueViolation } from '@/lib/middleware/server/db';
import {
  findUserById,
  issueSession,
  toPublicUser,
} from '@/lib/middleware/server/auth-service';
import type { SessionResponse } from '@/types';

export const runtime = 'nodejs';

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' ') || parts[0] || '',
  };
}

export const POST = createHandler(
  {
    name: 'auth.register',
    auth: 'none',
    body: registerSchema,
    rateLimit: { limit: 5, windowMs: 15 * 60_000, by: 'ip' },
    successStatus: 201,
  },
  async (ctx) => {
    const { firstName, lastName } = splitName(ctx.body.name);
    const passwordHash = await hashPassword(ctx.body.password);

    const { data, error } = await db()
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        display_name: ctx.body.name.trim(),
        email: ctx.body.email ?? null,
        phone: ctx.body.phone ?? null,
        password_hash: passwordHash,
        role: 'requester',
        // A prototype account is usable immediately. Change to 'pending' when
        // email/phone verification lands (documented as deferred, Block 8).
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          'CONFLICT',
          'An account with that email address or phone number already exists.',
        );
      }
      throw ApiError.internal('Could not create that account.', error.message);
    }

    const userId = (data as { id: string }).id;

    if (ctx.body.emergencyContactName && ctx.body.emergencyContactPhone) {
      // A failed contact insert must not cost the user their account.
      const contact = await db().from('emergency_contacts').insert({
        user_id: userId,
        full_name: ctx.body.emergencyContactName,
        phone: ctx.body.emergencyContactPhone,
        is_primary: true,
      });
      if (contact.error) {
        ctx.log.warn('emergency_contact_insert_failed', { dbError: contact.error.message });
      }
    }

    const user = await findUserById(userId);
    if (!user) throw ApiError.internal('The account was created but could not be read back.');

    const session = await issueSession(user, {
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
    });

    await writeSecurityEvent({
      action: 'auth.register',
      actorId: userId,
      actorRole: 'requester',
      targetType: 'user',
      targetId: userId,
      result: 'success',
      correlationId: ctx.requestId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    const payload: SessionResponse = {
      user: await toPublicUser(user),
      accessExpiresAt: session.accessExpiresAt,
    };

    return setAuthCookies(jsonOk(payload, ctx.requestId, { status: 201 }), {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  },
);

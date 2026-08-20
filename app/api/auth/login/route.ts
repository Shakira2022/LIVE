/**
 * POST /api/auth/login   (Block 2, Person 6)
 *
 * Replaces the hand-written route that previously lived here. Differences:
 *   - No console.log of identifiers, URLs or key presence (those lines leaked
 *     PII and configuration into the hosting logs).
 *   - Issues a real JWT pair instead of returning the user object for
 *     localStorage. Tokens go into httpOnly cookies.
 *   - Rate limited, audited, and returns the uniform { ok, data, requestId }
 *     envelope like every other endpoint.
 *
 * The REQUEST shape is unchanged - { identifier, password } - so
 * components/auth/auth-provider.tsx keeps working. The RESPONSE moves the user
 * from `result.user` to `result.data.user`; see the notes in the integration
 * plan for the one-line change on the client.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { setAuthCookies } from '@/lib/middleware/api/cookies';
import { writeSecurityEvent } from '@/lib/middleware/api/audit';
import { jsonOk } from '@/lib/middleware/api/response';
import { ApiError } from '@/lib/middleware/errors';
import { loginSchema } from '@/lib/middleware/validation';
import { burnPasswordTime, verifyPassword } from '@/lib/middleware/password';
import {
  canSignIn,
  findUserByIdentifier,
  isLocked,
  issueSession,
  recordFailedLogin,
  recordSuccessfulLogin,
  toPublicUser,
} from '@/lib/middleware/server/auth-service';
import type { SessionResponse } from '@/types';

export const runtime = 'nodejs';

export const POST = createHandler(
  {
    name: 'auth.login',
    auth: 'none',
    body: loginSchema,
    // Brute-force protection: 10 attempts per IP per 5 minutes.
    rateLimit: { limit: 10, windowMs: 5 * 60_000, by: 'ip' },
  },
  async (ctx) => {
    const user = await findUserByIdentifier(ctx.body.identifier);

    if (!user) {
      // Spend the same time as a real bcrypt compare so response timing does
      // not reveal which identifiers are registered.
      await burnPasswordTime();
      await writeSecurityEvent({
        action: 'auth.login.failed',
        targetType: 'user',
        result: 'denied',
        correlationId: ctx.requestId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
        metadata: { reason: 'not_found' },
      });
      throw new ApiError('UNAUTHENTICATED', 'The email/phone or password is incorrect.');
    }

    if (isLocked(user)) {
      await writeSecurityEvent({
        action: 'auth.login.locked',
        actorId: user.id,
        actorRole: user.role,
        targetType: 'user',
        targetId: user.id,
        result: 'denied',
        correlationId: ctx.requestId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
      });
      throw new ApiError(
        'FORBIDDEN',
        'This account is temporarily locked after too many attempts. Try again in 15 minutes.',
      );
    }

    if (!canSignIn(user)) {
      await writeSecurityEvent({
        action: 'auth.login.inactive',
        actorId: user.id,
        actorRole: user.role,
        targetType: 'user',
        targetId: user.id,
        result: 'denied',
        correlationId: ctx.requestId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
        metadata: { status: user.status },
      });
      throw new ApiError('FORBIDDEN', 'This account is not active.');
    }

    const correct = await verifyPassword(ctx.body.password, user.password_hash);
    if (!correct) {
      await recordFailedLogin(user);
      await writeSecurityEvent({
        action: 'auth.login.failed',
        actorId: user.id,
        actorRole: user.role,
        targetType: 'user',
        targetId: user.id,
        result: 'denied',
        correlationId: ctx.requestId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
        metadata: { reason: 'bad_password' },
      });
      throw new ApiError('UNAUTHENTICATED', 'The email/phone or password is incorrect.');
    }

    const session = await issueSession(user, {
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
    });

    await recordSuccessfulLogin(user);

    await writeSecurityEvent({
      action: 'auth.login.success',
      actorId: user.id,
      actorRole: user.role,
      targetType: 'user',
      targetId: user.id,
      result: 'success',
      correlationId: ctx.requestId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      metadata: { sessionId: session.sessionId },
    });

    const payload: SessionResponse = {
      user: await toPublicUser(user),
      accessExpiresAt: session.accessExpiresAt,
    };

    return setAuthCookies(jsonOk(payload, ctx.requestId), {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  },
);

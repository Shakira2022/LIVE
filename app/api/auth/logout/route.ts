/**
 * POST /api/auth/logout   (Block 2, Person 6)
 *
 * Sign-out has to be real: the refresh jti is revoked in device_sessions so a
 * copied refresh token cannot renew a session after the user has left.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { clearAuthCookies } from '@/lib/middleware/api/cookies';
import { writeSecurityEvent } from '@/lib/middleware/api/audit';
import { jsonOk } from '@/lib/middleware/api/response';
import { COOKIE_REFRESH } from '@/lib/middleware/env';
import { verifyRefreshToken } from '@/lib/middleware/jwt';
import { jwtSettings, revokeSession } from '@/lib/middleware/server/auth-service';

export const runtime = 'nodejs';

export const POST = createHandler(
  { name: 'auth.logout', auth: 'optional' },
  async (ctx) => {
    const refreshToken = ctx.req.cookies.get(COOKIE_REFRESH)?.value;

    if (refreshToken) {
      const outcome = await verifyRefreshToken(jwtSettings(), refreshToken);
      if (outcome.valid) {
        await revokeSession(outcome.claims.jti, 'signed_out');
      }
    }

    await writeSecurityEvent({
      action: 'auth.logout',
      actorId: ctx.auth?.userId ?? null,
      actorRole: ctx.auth?.role ?? null,
      targetType: 'user',
      targetId: ctx.auth?.userId ?? null,
      result: 'success',
      correlationId: ctx.requestId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    // Cookies are cleared whether or not a valid session was found, so a
    // half-broken session can always be escaped from the UI.
    return clearAuthCookies(jsonOk({ signedOut: true }, ctx.requestId));
  },
);

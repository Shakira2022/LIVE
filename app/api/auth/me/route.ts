/**
 * GET /api/auth/me   (Block 2, Person 6)
 *
 * The client asks the SERVER who it is instead of trusting a user object it
 * kept in localStorage. This is what lets auth-provider.tsx stop being the
 * source of truth for identity and role.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { ApiError } from '@/lib/middleware/errors';
import { findUserById, toPublicUser } from '@/lib/middleware/server/auth-service';
import type { SessionResponse } from '@/types';

export const runtime = 'nodejs';

export const GET = createHandler(
  { name: 'auth.me', auth: 'required' },
  async (ctx): Promise<SessionResponse> => {
    const user = await findUserById(ctx.user.userId);
    if (!user) throw ApiError.unauthenticated('This account no longer exists.');

    return {
      user: await toPublicUser(user),
      accessExpiresAt: ctx.user.expiresAt,
    };
  },
);

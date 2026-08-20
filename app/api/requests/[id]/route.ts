/**
 * GET /api/requests/[id]   (Block 5 Person 8, Block 6 Person 10)
 *
 * Single request with history, assignments and notes. Visibility is enforced
 * inside getRequestDetail(): a requester who asks for someone else's id gets a
 * 404, not a 403, so the endpoint does not confirm that the record exists.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { idParamSchema } from '@/lib/middleware/validation';
import { getRequestDetail } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const GET = createHandler(
  {
    name: 'requests.detail',
    auth: 'required',
    params: idParamSchema,
    rateLimit: { limit: 240, windowMs: 60_000, by: 'user' },
  },
  async (ctx) => getRequestDetail(ctx.params.id, ctx.user),
);

/**
 * POST /api/requests/[id]/cancel   (Block 6, Person 11)
 *
 * Requests without an active assignment are cancelled immediately. If a
 * responder is assigned, the request stays active until dispatch approves.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { cancelSchema, idParamSchema } from '@/lib/middleware/validation';
import { requestCancellation } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const POST = createHandler(
  {
    name: 'requests.cancel_request',
    auth: 'required',
    roles: ['requester'],
    params: idParamSchema,
    body: cancelSchema,
    rateLimit: { limit: 20, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.cancellation_requested', targetType: 'emergency_request' },
  },
  async (ctx) => {
    const request = await requestCancellation(ctx.params.id, ctx.user, ctx.body.reason);
    ctx.audit({ targetId: request.id, reference: request.reference });
    return request;
  },
);

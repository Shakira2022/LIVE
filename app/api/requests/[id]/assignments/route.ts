/**
 * POST /api/requests/[id]/assignments   (Block 6, Person 11)
 *
 * Assigns a responder / team / vehicle, routes the request to the assigning
 * organisation, and moves the status to 'assigned' in one call so the board and
 * the requester's tracking page can never disagree.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { assignmentSchema, idParamSchema } from '@/lib/middleware/validation';
import { assignRequest } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const POST = createHandler(
  {
    name: 'requests.assign',
    auth: 'required',
    roles: ['dispatcher', 'admin'],
    params: idParamSchema,
    body: assignmentSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.assigned', targetType: 'emergency_request' },
  },
  async (ctx) => {
    const request = await assignRequest(ctx.params.id, ctx.user, ctx.body);
    ctx.audit({
      targetId: request.id,
      reference: request.reference,
      responderUserId: ctx.body.responderUserId ?? null,
      teamId: ctx.body.teamId ?? null,
    });
    return request;
  },
);

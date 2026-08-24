/**
 * PATCH /api/requests/[id]/status   (Block 6, Persons 11 and 12)
 *
 * The only way a request's status ever changes. Transition legality and role
 * permission are both checked in lib/middleware/status.ts before the write,
 * and every change appends a request_status_history row recording WHO changed
 * it and WHEN (Person 12's task).
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { idParamSchema, statusChangeSchema } from '@/lib/middleware/validation';
import { changeStatus } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const PATCH = createHandler(
  {
    name: 'requests.status',
    auth: 'required',
    roles: ['requester', 'responder', 'dispatcher', 'admin'],
    params: idParamSchema,
    body: statusChangeSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.status_changed', targetType: 'emergency_request' },
  },
  async (ctx) => {
    const request = await changeStatus(ctx.params.id, ctx.user, ctx.body);
    ctx.audit({
      targetId: request.id,
      reference: request.reference,
      newStatus: request.currentStatus,
    });
    return request;
  },
);

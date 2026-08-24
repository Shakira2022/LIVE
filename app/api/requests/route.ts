/**
 * /api/requests   (Block 5 Persons 7-10, Block 6 Person 10)
 *
 * GET  - list requests visible to the caller. A requester is forced onto their
 *        own rows inside the query, so ownership cannot be bypassed by paging.
 * POST - submit a new emergency request. Idempotent on idempotencyKey.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { createRequestSchema, listQuerySchema } from '@/lib/middleware/validation';
import { createRequest, listRequests } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const GET = createHandler(
  {
    name: 'requests.list',
    auth: 'required',
    query: listQuerySchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: 'user' },
  },
  async (ctx) => {
    const { items, total } = await listRequests(ctx.user, {
      scope: ctx.query.scope,
      status: ctx.query.status,
      search: ctx.query.search,
      limit: ctx.query.limit,
      offset: ctx.query.offset,
    });

    return {
      items,
      total,
      limit: ctx.query.limit,
      offset: ctx.query.offset,
    };
  },
);

export const POST = createHandler(
  {
    name: 'requests.create',
    auth: 'required',
    roles: ['requester', 'dispatcher', 'admin'],
    body: createRequestSchema,
    // Deliberately generous: a person in an emergency may tap twice. The
    // idempotency key is what actually prevents duplicates; this only stops
    // a script.
    rateLimit: { limit: 10, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.created', targetType: 'emergency_request' },
    successStatus: 201,
  },
  async (ctx) => {
    const { request, routing } = await createRequest(ctx.user, ctx.body);

    // The routing decision is auditable: which organisation, how far, how many
    // were in range, and - when nothing was chosen - why not. Coordinates are
    // deliberately NOT recorded here; they are personal data.
    ctx.audit({
      targetId: request.id,
      reference: request.reference,
      severity: request.severity,
      routedOrganisationId: routing.organisationId,
      routingReason: routing.reason,
      routingDistanceMetres: routing.distanceMetres,
      routingCandidates: routing.candidateCount,
    });

    return request;
  },
);

/**
 * /api/requests
 *
 * GET
 *   Lists emergency requests visible to the authenticated user.
 *
 * POST
 *   Creates an emergency request for an authenticated requester,
 *   dispatcher or administrator.
 *
 * Identity comes from the signed JWT handled by createHandler().
 * The client must never supply a phone number or user ID to decide
 * whose requests are returned.
 */

import { createHandler } from "@/lib/middleware/api/handler";

import {
  createRequestSchema,
  listQuerySchema,
} from "@/lib/middleware/validation";

import {
  createRequest,
  listRequests,
} from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

/* ============================================================
   GET /api/requests
   ============================================================ */

export const GET = createHandler(
  {
    name: "requests.list",

    auth: "required",

    query: listQuerySchema,

    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },

  async (ctx) => {
    const {
      items,
      total,
    } = await listRequests(
      ctx.user,
      {
        scope:
          ctx.query.scope,

        status:
          ctx.query.status,

        search:
          ctx.query.search,

        limit:
          ctx.query.limit,

        offset:
          ctx.query.offset,
      }
    );

    /*
     * createHandler automatically wraps this as:
     *
     * {
     *   ok: true,
     *   data: {
     *     items,
     *     total,
     *     limit,
     *     offset
     *   },
     *   requestId: "..."
     * }
     */

    return {
      items:
        items ?? [],

      total:
        total ?? 0,

      limit:
        ctx.query.limit,

      offset:
        ctx.query.offset,
    };
  }
);

/* ============================================================
   POST /api/requests
   ============================================================ */

export const POST = createHandler(
  {
    name: "requests.create",

    auth: "required",

    roles: [
      "requester",
      "dispatcher",
      "admin",
    ],

    body:
      createRequestSchema,

    /*
     * A person in an emergency may press submit twice.
     *
     * The idempotency key prevents duplicate emergency
     * requests. This rate limit is only protection against
     * abnormal repeated traffic.
     */
    rateLimit: {
      limit: 10,
      windowMs: 60_000,
      by: "user",
    },

    audit: {
      action:
        "request.created",

      targetType:
        "emergency_request",
    },

    successStatus: 201,
  },

  async (ctx) => {
    const {
      request,
      routing,
    } = await createRequest(
      ctx.user,
      ctx.body
    );

    /*
     * Store routing metadata in the audit event.
     *
     * Coordinates are intentionally excluded because
     * they are personal location information.
     */
    ctx.audit({
      targetId:
        request.id,

      reference:
        request.reference,

      severity:
        request.severity,

      routedOrganisationId:
        routing.organisationId,

      routingReason:
        routing.reason,

      routingDistanceMetres:
        routing.distanceMetres,

      routingCandidates:
        routing.candidateCount,
    });

    return request;
  }
);
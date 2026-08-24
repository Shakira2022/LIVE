/**
 * GET /api/requests/[id]
 *
 * Returns one emergency request visible to the authenticated user.
 *
 * IMPORTANT:
 *
 * This route intentionally ONLY handles GET.
 *
 * Request mutations have dedicated endpoints:
 *
 * PATCH /api/requests/[id]/status
 * POST  /api/requests/[id]/cancel
 * PUT   /api/requests/[id]/location
 * POST  /api/requests/[id]/notes
 * POST  /api/requests/[id]/assignments
 *
 * This keeps status-transition validation, role permissions,
 * auditing and ownership checks in the correct middleware service.
 */

import {
  createHandler,
} from "@/lib/middleware/api/handler";

import {
  idParamSchema,
} from "@/lib/middleware/validation";

import {
  getRequestDetail,
} from "@/lib/middleware/server/requests-service";

export const runtime =
  "nodejs";

/* ============================================================
   GET /api/requests/[id]
   ============================================================ */

export const GET =
  createHandler(
    {
      name:
        "requests.detail",

      auth:
        "required",

      params:
        idParamSchema,

      rateLimit: {
        limit: 240,
        windowMs: 60_000,
        by: "user",
      },
    },

    async (ctx) => {
      /*
       * getRequestDetail() performs the ownership /
       * visibility check.
       *
       * For a requester:
       * only their own emergency request is visible.
       *
       * Staff visibility follows the permissions defined
       * in requests-service.ts.
       */
      return getRequestDetail(
        ctx.params.id,
        ctx.user
      );
    }
  );
/**
 * PUT /api/requests/[id]/location   (Block 4, Persons 3, 4 and 5)
 *
 * Handles BOTH paths the requirements call for:
 *   - GPS permission granted -> locationMethod 'gps' with coordinates
 *   - GPS permission denied  -> locationMethod 'manual' with addressText
 * Latitude/longitude ranges are validated in validation.ts before this runs,
 * and again by the check constraints on request_locations.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { idParamSchema, locationUpdateSchema } from '@/lib/middleware/validation';
import { getRequestSummary, assertCanView, saveLocation, getRequestDetail } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const PUT = createHandler(
  {
    name: 'requests.location',
    auth: 'required',
    params: idParamSchema,
    body: locationUpdateSchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.location_updated', targetType: 'emergency_request' },
  },
  async (ctx) => {
    const summary = await getRequestSummary(ctx.params.id);
    assertCanView(summary, ctx.user);

    await saveLocation(ctx.params.id, ctx.body);

    ctx.audit({
      targetId: ctx.params.id,
      locationMethod: ctx.body.locationMethod,
      // Coordinates themselves are personal data: record only that they arrived.
      hasCoordinates: ctx.body.latitude !== undefined,
    });

    return getRequestDetail(ctx.params.id, ctx.user);
  },
);

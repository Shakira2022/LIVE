import { createHandler } from "@/lib/middleware/api/handler";
import { idParamSchema } from "@/lib/middleware/validation";
import { approveRequestCancellation } from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

export const PATCH = createHandler(
  {
    name: "requests.cancellation_approved",
    auth: "required",
    roles: ["dispatcher", "admin"],
    params: idParamSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: { action: "request.cancellation_approved", targetType: "emergency_request" },
  },
  async (ctx) => {
    const request = await approveRequestCancellation(ctx.params.id, ctx.user);
    ctx.audit({ targetId: request.id, reference: request.reference });
    return request;
  },
);

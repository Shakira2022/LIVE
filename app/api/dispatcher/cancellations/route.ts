import { createHandler } from "@/lib/middleware/api/handler";
import { listCancellationRequests } from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "dispatcher.cancellation_requests",
    auth: "required",
    roles: ["dispatcher", "admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => ({ items: await listCancellationRequests(ctx.user) }),
);

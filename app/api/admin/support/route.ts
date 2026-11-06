import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const GET = createHandler({ name: "admin.support.list", auth: "required", roles: ["admin"] }, async () => {
  const { data, error } = await db().from("support_requests").select("id, requester_name, requester_email, category, subject, status, created_at, updated_at").order("updated_at", { ascending: false }).limit(200);
  if (error) throw ApiError.internal("Unable to load support requests.", error.message);
  return { requests: data ?? [] };
});

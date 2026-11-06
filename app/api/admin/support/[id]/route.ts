import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

const paramsSchema = z.object({ id: z.string().uuid() });
const statusSchema = z.object({ status: z.enum(["open", "in_progress", "waiting_on_user", "resolved", "closed"]) });

export const GET = createHandler({ name: "admin.support.detail", auth: "required", roles: ["admin"], params: paramsSchema }, async (ctx) => {
  const client = db();
  const { data: request, error } = await client.from("support_requests").select("*").eq("id", ctx.params.id).maybeSingle();
  if (error) throw ApiError.internal("Unable to load this support request.", error.message);
  if (!request) throw ApiError.notFound("Support request not found.");
  const { data: messages, error: messagesError } = await client.from("support_messages").select("*").eq("support_request_id", ctx.params.id).order("created_at", { ascending: true });
  if (messagesError) throw ApiError.internal("Unable to load the support conversation.", messagesError.message);
  return { request, messages: messages ?? [] };
});

export const PATCH = createHandler({ name: "admin.support.status", auth: "required", roles: ["admin"], params: paramsSchema, body: statusSchema, audit: { action: "support_request_status_updated", targetType: "support_request" } }, async (ctx) => {
  const { data, error } = await db().from("support_requests").update({ status: ctx.body.status, updated_at: new Date().toISOString() }).eq("id", ctx.params.id).select("id, status").maybeSingle();
  if (error) throw ApiError.internal("Unable to update this support request.", error.message);
  if (!data) throw ApiError.notFound("Support request not found.");
  ctx.audit({ targetId: data.id, status: data.status });
  return { request: data };
});

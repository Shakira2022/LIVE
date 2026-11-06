import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { sendSupportEmail } from "@/lib/support-email";

export const runtime = "nodejs";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ message: z.string().trim().min(2).max(8000) });

export const POST = createHandler({ name: "admin.support.reply", auth: "required", roles: ["admin"], params: paramsSchema, body: bodySchema, audit: { action: "support_request_replied", targetType: "support_request" } }, async (ctx) => {
  const client = db();
  const { data: request, error } = await client.from("support_requests").select("id, requester_name, requester_email, subject").eq("id", ctx.params.id).maybeSingle();
  if (error) throw ApiError.internal("Unable to load this support request.", error.message);
  if (!request) throw ApiError.notFound("Support request not found.");
  const { data: admin, error: adminError } = await client.from("users").select("email, first_name, last_name, display_name").eq("id", ctx.user.userId).maybeSingle();
  if (adminError) throw ApiError.internal("Unable to load the Admin account.", adminError.message);
  const senderName = admin?.display_name?.trim() || [admin?.first_name, admin?.last_name].filter(Boolean).join(" ").trim() || "LIVE Support";
  const { data: saved, error: saveError } = await client.from("support_messages").insert({
    support_request_id: request.id, sender_user_id: ctx.user.userId, sender_type: "admin", sender_name: senderName,
    sender_email: admin?.email || "", body: ctx.body.message, email_status: "not_sent",
  }).select("*").single();
  if (saveError || !saved) throw ApiError.internal("Unable to save your reply.", saveError?.message);

  let emailSent = false;
  try {
    await sendSupportEmail(request.requester_email, `LIVE Support [${request.id}]: ${request.subject}`, `Hello ${request.requester_name},\n\n${ctx.body.message}\n\nIf you need further help, visit LIVE Support and include ticket reference ${request.id}.`);
    emailSent = true;
  } catch (error) {
    await client.from("support_messages").update({ email_status: "failed" }).eq("id", saved.id);
    ctx.log.error("support_reply_email_failed", { cause: error instanceof Error ? error.message : String(error), ticketId: request.id });
    throw ApiError.internal("The reply was saved, but its email could not be sent. Check the email service and retry.");
  }
  await client.from("support_messages").update({ email_status: "sent", email_sent_at: new Date().toISOString() }).eq("id", saved.id);
  await client.from("support_requests").update({ status: "waiting_on_user", updated_at: new Date().toISOString() }).eq("id", request.id);
  ctx.audit({ targetId: request.id, emailSent });
  return { message: { ...saved, email_status: "sent" }, emailSent };
});

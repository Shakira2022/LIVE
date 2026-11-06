import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { sendSupportEmail, supportMailbox } from "@/lib/support-email";

export const runtime = "nodejs";
const categories = ["Account access", "Profile or account details", "Request or incident", "Map or location", "Calls or notifications", "Technical problem", "Other"] as const;
const bodySchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  category: z.enum(categories),
  subject: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().min(10).max(8000),
});

export const POST = createHandler({
  name: "support.request.create", auth: "optional", body: bodySchema,
  rateLimit: { limit: 5, windowMs: 60 * 60_000, by: "ip+user" }, successStatus: 201,
  audit: { action: "support_request_created", targetType: "support_request" },
}, async (ctx) => {
  const client = db();
  let userId: string | null = null;
  let name = ctx.body.name;
  let email = ctx.body.email || "";
  if (ctx.auth) {
    const { data: user, error } = await client.from("users").select("email, first_name, last_name, display_name").eq("id", ctx.auth.userId).is("deleted_at", null).maybeSingle();
    if (error) throw ApiError.internal("Unable to load your account details.", error.message);
    if (!user?.email) throw new ApiError("BAD_REQUEST", "Add an email address to your account before contacting support.");
    userId = ctx.auth.userId;
    email = user.email;
    name = user.display_name?.trim() || [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || name || "LIVE user";
  } else if (!name.trim() || !email) {
    throw new ApiError("VALIDATION_FAILED", "Enter your name and email address to contact support.");
  }

  const { data: ticket, error: ticketError } = await client.from("support_requests").insert({
    user_id: userId, requester_name: name.trim(), requester_email: email, category: ctx.body.category,
    subject: ctx.body.subject || ctx.body.category, status: "open",
  }).select("id").single();
  if (ticketError || !ticket) throw ApiError.internal("Unable to save your support request.", ticketError?.message);
  const { error: messageError } = await client.from("support_messages").insert({
    support_request_id: ticket.id, sender_user_id: userId, sender_type: "requester", sender_name: name.trim(),
    sender_email: email, body: ctx.body.message, email_status: "not_sent",
  });
  if (messageError) {
    await client.from("support_requests").delete().eq("id", ticket.id);
    throw ApiError.internal("Unable to save your support message.", messageError.message);
  }

  const mailbox = supportMailbox();
  let notified = false;
  if (mailbox) {
    try {
      await sendSupportEmail(mailbox, `[LIVE Support] ${ctx.body.category}: ${ctx.body.subject || ctx.body.category}`, `New support request\n\nFrom: ${name} <${email}>\nCategory: ${ctx.body.category}\nTicket: ${ticket.id}\n\n${ctx.body.message}`);
      notified = true;
    } catch (error) {
      ctx.log.error("support_notification_email_failed", { cause: error instanceof Error ? error.message : String(error), ticketId: ticket.id });
    }
  }
  ctx.audit({ targetId: ticket.id, category: ctx.body.category, emailNotified: notified });
  return { id: ticket.id, emailNotified: notified };
});

/**
 * /api/assistant/chat   (Backend - AI chatbot logic)
 *
 * GET  - opening message and suggested questions for the caller's role.
 * POST - answers one chat message.
 *
 * Runs through createHandler(), so it gets the same middleware pipeline as
 * every other endpoint: request id, security headers, rate limiting,
 * optional authentication, Zod validation, safe error handling and an
 * application-log row per message.
 *
 * Signed-in users get role-specific help. Signed-out visitors (login and
 * register pages) are answered as "guest" and only see public topics.
 *
 * Answer order - the safest source always wins:
 *   1. Safety rules     emergency wording -> emergency numbers + Request help
 *   2. Knowledge base   curated, role-aware answers about how LIVE works
 *   3. AI service       Gemini or Ollama, grounded on the knowledge base
 *   4. Fallback         polite "I don't know" with suggested questions
 */

import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { generateText, sanitiseForPrompt } from "@/lib/assistant/ai-providers";
import {
  answerableFollowUps,
  greetingFor,
  isUrgentMessage,
  knowledgeDigest,
  matchTopic,
  suggestionsFor,
  urgentReply,
  type AssistantAction,
  type AssistantReply,
  type AssistantRole,
} from "@/lib/assistant/knowledge-base";

export const runtime = "nodejs";

const historyItem = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(2000),
});

const chatSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Type or say a question first.")
    .max(500, "Keep questions under 500 characters."),
  history: z.array(historyItem).max(12).optional(),
  /** The page the user is on, so answers can be about that screen. */
  page: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_\-[\]]*$/, "Invalid page path.")
    .optional(),
});

function roleOf(auth: { role: string } | null): AssistantRole {
  return (auth?.role as AssistantRole | undefined) ?? "guest";
}

/** Only offer links the caller can actually open. */
function allowedActions(actions: AssistantAction[] | undefined, role: AssistantRole): AssistantAction[] {
  return (actions ?? []).filter((action) => {
    if (!action.href.startsWith("/app/")) return true; // public pages
    if (role === "guest") return false;
    return action.href.startsWith(`/app/${role}`) || (role === "admin" && action.href.startsWith("/app/"));
  });
}

export const GET = createHandler(
  {
    name: "assistant.welcome",
    auth: "optional",
    rateLimit: { limit: 60, windowMs: 60_000, by: "ip+user" },
  },
  async (ctx) => {
    const role = roleOf(ctx.auth);
    return {
      role,
      greeting: greetingFor(role),
      suggestions: suggestionsFor(role),
      // Tells the UI whether answers outside the knowledge base are possible.
      aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.OLLAMA_BASE_URL?.trim()),
    };
  },
);

export const POST = createHandler(
  {
    name: "assistant.chat",
    auth: "optional",
    body: chatSchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "ip+user" },
    audit: { action: "assistant.message", targetType: "assistant", logType: "application" },
  },
  async (ctx): Promise<AssistantReply> => {
    const role = roleOf(ctx.auth);
    const { message, history = [], page } = ctx.body;

    // 1. Safety rules first - deterministic, never delegated to a model.
    if (isUrgentMessage(message)) {
      const urgent = urgentReply(role);
      ctx.audit({ source: "safety-rules", urgent: true, role });
      return { ...urgent, actions: allowedActions(urgent.actions, role), source: "safety-rules", urgent: true };
    }

    // 2. Knowledge base.
    const match = matchTopic(message, role);
    if (match) {
      ctx.audit({ source: "knowledge-base", topic: match.topic.id, role });
      return {
        reply: match.topic.answer,
        quickReplies: answerableFollowUps(match.topic, role),
        actions: allowedActions(match.topic.actions, role),
        source: "knowledge-base",
        urgent: false,
      };
    }

    // 3. AI service, grounded on the knowledge base.
    const recent = history
      .slice(-6)
      .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${sanitiseForPrompt(item.text, 400)}`)
      .join("\n");

    const prompt = [
      "You are the LIVE assistant inside LIVE, a South African emergency request and response tracking web app.",
      `The user's role is: ${role}.${page ? ` They are on the page ${page}.` : ""}`,
      "Rules:",
      "- Answer in plain, friendly English, in at most 6 short sentences or a short numbered list.",
      "- Only describe LIVE features that appear in the reference below. If you are not sure, say so and suggest contacting an administrator.",
      "- Never diagnose medical conditions and never replace emergency responders.",
      "- For any danger to life, tell the user to call 10177 (ambulance/fire), 10111 (police) or 112 from a mobile.",
      "- Do not ask for passwords, ID numbers or bank details.",
      "",
      "Reference - how LIVE works:",
      knowledgeDigest(role),
      "",
      recent ? `Conversation so far:\n${recent}\n` : "",
      `User question: ${sanitiseForPrompt(message, 500)}`,
      "Answer:",
    ].join("\n");

    const ai = await generateText(prompt, { feature: "assistant.chat", correlationId: ctx.requestId, maxTokens: 350 });
    if (ai) {
      ctx.audit({ source: "ai", provider: ai.source, model: ai.model, role });
      return {
        reply: ai.text.slice(0, 1800),
        quickReplies: suggestionsFor(role).slice(0, 3),
        actions: [],
        source: "ai",
        urgent: false,
      };
    }

    // 4. Fallback.
    ctx.audit({ source: "fallback", role });
    return {
      reply:
        "I'm not sure about that one yet. I can help with the topics below, or you can rephrase your question. If anyone is in danger, call **10177** or **112** now.",
      quickReplies: suggestionsFor(role),
      actions: [],
      source: "fallback",
      urgent: false,
    };
  },
);

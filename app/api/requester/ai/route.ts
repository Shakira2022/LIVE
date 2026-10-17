import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";

export const runtime = "nodejs";

const requestSchema = z.object({
  emergency: z.object({
    id: z.string().min(1), category: z.string().min(1).max(120), severity: z.string().min(1).max(40), note: z.string().max(2000), status: z.string().max(40),
    location: z.object({ address: z.string().max(300), lat: z.number().optional(), lng: z.number().optional() }),
  }),
  question: z.string().trim().min(1).max(500),
  messages: z.array(z.object({ role: z.enum(["assistant", "user"]), text: z.string().max(2000) })).max(20).optional(),
  answers: z.array(z.object({ question: z.string().max(500), answer: z.string().max(200) })).max(20).optional(),
});

function fallbackAnswer(question: string, emergency: z.infer<typeof requestSchema>["emergency"]) {
  const text = question.toLowerCase();
  if (text.includes("cpr") || text.includes("not breathing") || text.includes("stopped breathing")) {
    return "Call your local emergency number now and put the phone on speaker. If the person is unresponsive and not breathing normally, place them on a firm, flat surface. Push hard and fast in the center of the chest, about 100 to 120 pushes each minute. Let the chest come back up after each push. Follow the emergency dispatcher's instructions. If you are trained and willing, give 2 breaths after every 30 pushes; otherwise continue hands-only CPR until help takes over.";
  }
  if (text.includes("trapped") || text.includes("unable to move")) return "Tell the responder immediately that someone may be trapped or unable to move. Do not move an injured person unless there is immediate danger, such as fire or traffic. Keep the area clear for responders.";
  if (text.includes("breathing") || text.includes("unconscious")) return "Check whether the person responds and is breathing normally. Tell the responder exactly what you observe. Do not give food or drink to an unconscious person, and follow instructions from emergency professionals.";
  if (text.includes("bleeding")) return "Apply firm direct pressure with clean cloth or clothing if it is safe to do so. Do not remove an embedded object. Tell responders about the bleeding and keep the person still and warm.";
  return `For this ${emergency.category.toLowerCase()} emergency, stay in a safe place, keep your phone available, and share any new danger or change with the responder. Your reported location is ${emergency.location.address}. If the situation becomes immediately life-threatening, contact local emergency services directly.`;
}

export const POST = createHandler(
  { name: "requester.ai", auth: "required", roles: ["requester"], body: requestSchema, rateLimit: { limit: 30, windowMs: 60_000, by: "user" } },
  async (ctx) => {
    const { emergency, question, messages = [], answers = [] } = ctx.body;
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL || "gemma3:1b-it-q4_K_M";

    // Urgent CPR guidance must not depend on a small model correctly
    // following the conversation. Route it directly to the safety guidance.
    if (/\bcpr\b|not breathing|stopped breathing/i.test(question)) {
      return { answer: fallbackAnswer(question, emergency), model: "local-safety-guidance" };
    }

    const prompt = [
      "You are LIVE emergency support.",
      "Give short, calm, practical safety guidance.",
      "Never diagnose and never replace emergency responders.",
      "Tell the user to contact local emergency services for immediate danger.",
      "Use only the supplied emergency context.",
      "",
      `Emergency context: ${JSON.stringify(emergency)}`,
      `Conversation so far: ${JSON.stringify(messages)}`,
      `Follow-up answers: ${JSON.stringify(answers)}`,
      `Latest user question: ${question}`,
      "The latest user question is the priority. Answer it directly and do not repeat or ask a previous follow-up question unless the user specifically asks for that information.",
      "If the latest question asks about CPR or a person who is not breathing normally, answer the CPR question directly: tell them to call the local emergency number and use speakerphone, check responsiveness and normal breathing, start hard and fast chest compressions in the center of the chest at 100 to 120 per minute on a firm flat surface, follow the dispatcher, and mention rescue breaths only as an option for someone trained and willing.",
      "If the user asks to explain something simply, explain the previous answer in child-friendly language and keep the same subject. Do not change the subject to an earlier follow-up question.",
      "Use short paragraphs or a numbered list when steps are needed. Do not include a follow-up question at the end unless it is essential for immediate safety.",
    ].join("\n");

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2, num_predict: 220 } }),
      });

      if (!response.ok) throw new Error("Ollama request failed.");
      const payload = await response.json() as { response?: string };
      return { answer: payload.response?.trim() || fallbackAnswer(question, emergency), model };
    } catch {
      return { answer: fallbackAnswer(question, emergency), model: "local-safety-fallback" };
    }
  },
);

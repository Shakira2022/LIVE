import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const preferencesSchema = z.object({
  voiceGuidance: z.boolean(),
  blindVoiceGuidance: z.boolean(),
  voiceNavigation: z.boolean(),
  voiceCommandsActive: z.boolean(),
  skipIncidentDetails: z.boolean(),
}).strict();

const DEFAULT_PREFERENCES = {
  voiceGuidance: false,
  blindVoiceGuidance: false,
  voiceNavigation: false,
  voiceCommandsActive: true,
  skipIncidentDetails: true,
};

export const GET = createHandler(
  { name: "requester.preferences.read", auth: "required", roles: ["requester"] },
  async (ctx) => {
    const { data, error } = await db()
      .from("requester_preferences")
      .select("preferences")
      .eq("user_id", ctx.user.userId)
      .maybeSingle();
    if (error) throw ApiError.internal("Unable to load voice preferences.", error.message);
    return { preferences: { ...DEFAULT_PREFERENCES, ...((data?.preferences as Partial<typeof DEFAULT_PREFERENCES> | null) ?? {}) } };
  },
);

export const PATCH = createHandler(
  {
    name: "requester.preferences.update",
    auth: "required",
    roles: ["requester"],
    body: preferencesSchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const { error } = await db().from("requester_preferences").upsert({
      user_id: ctx.user.userId,
      preferences: ctx.body,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw ApiError.internal("Unable to save voice preferences.", error.message);
    return { saved: true, preferences: ctx.body };
  },
);

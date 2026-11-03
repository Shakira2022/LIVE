import { NextResponse } from "next/server";

import { createHandler } from "@/lib/middleware/api/handler";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const WHISPER_URL = process.env.WHISPER_API_URL ?? "http://127.0.0.1:8000";

const ALLOWED_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".ogg",
  ".webm",
  ".flac",
  ".mp4",
  ".aac",
]);

// Both voice pages read { ok, text, message }, so we return that shape directly.
function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export const POST = createHandler(
  {
    name: "requester.transcribe",
    auth: "required",
    roles: ["requester"],
    rateLimit: { limit: 10, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    // 1. Read the uploaded audio file.
    let formData: FormData;
    try {
      formData = await ctx.req.formData();
    } catch {
      return fail("Invalid upload.", 400);
    }

    const audio = formData.get("file");

    if (!(audio instanceof File)) {
      return fail("Please provide an audio file.", 400);
    }

    // 2. Check the file extension.
    const filename = audio.name.toLowerCase();
    const lastDot = filename.lastIndexOf(".");
    const extension = lastDot >= 0 ? filename.slice(lastDot) : "";

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return fail("Unsupported audio format.", 400);
    }

    // 3. Check that the file is not empty or too large.
    if (audio.size === 0) {
      return fail("The audio file is empty.", 400);
    }

    if (audio.size > MAX_FILE_SIZE) {
      return fail("Audio must not exceed 15 MB.", 413);
    }

    // 4. Forward the audio to the Python Whisper service.
    const whisperForm = new FormData();
    whisperForm.append("file", audio, audio.name);

    let whisperResponse: Response;

    try {
      whisperResponse = await fetch(`${WHISPER_URL}/transcribe`, {
        method: "POST",
        body: whisperForm,
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      ctx.log.warn("whisper_unreachable");
      return fail("The transcription service is unavailable. Please try again.", 503);
    }

    // 5. Handle errors returned by Whisper.
    if (!whisperResponse.ok) {
      ctx.log.warn("whisper_failed", { whisperStatus: whisperResponse.status });
      return fail(
        "Audio transcription failed.",
        whisperResponse.status === 413 ? 413 : 502,
      );
    }

    const result = await whisperResponse.json();

    if (typeof result.text !== "string" || typeof result.language !== "string") {
      return fail("The transcription response was invalid.", 502);
    }

    // 6. Return the transcript. The text itself is never logged.
    return NextResponse.json({
      ok: true,
      text: result.text,
      language: result.language,
    });
  },
);
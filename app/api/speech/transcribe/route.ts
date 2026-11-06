/**
 * GET  /api/speech/transcribe   -> { available }  (is LIVE's own speech service set up?)
 * POST /api/speech/transcribe   body: the raw audio clip (Content-Type audio/*)
 *                               -> { text }
 *
 * Signed-in users only, rate limited, 4 MB / ~60 s cap. The clip is passed to
 * Gemini for transcription and discarded; nothing is stored.
 */
import { createHandler } from '@/lib/middleware/api/handler';
import { ApiError } from '@/lib/middleware/errors';
import { ALLOWED_AUDIO_TYPES, looksLikeAudio, speechServiceConfigured, transcribeAudio } from '@/lib/speech/transcribe-server';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024;

export const GET = createHandler(
  { name: 'speech.status', auth: 'required', rateLimit: { limit: 60, windowMs: 60_000, by: 'user' } },
  async () => ({ available: speechServiceConfigured() }),
);

export const POST = createHandler(
  {
    name: 'speech.transcribe',
    auth: 'required',
    rateLimit: { limit: 30, windowMs: 60_000, by: 'user' },
  },
  async (ctx) => {
    if (!speechServiceConfigured()) {
      throw new ApiError('UPSTREAM_FAILED', 'Voice input is not set up on this server yet. You can type or tap instead.');
    }

    const mime = (ctx.req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!(ALLOWED_AUDIO_TYPES as readonly string[]).includes(mime)) {
      throw new ApiError('BAD_REQUEST', 'That recording format is not supported.');
    }
    const declared = Number(ctx.req.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      throw new ApiError('BAD_REQUEST', 'That recording is too long. Keep it under a minute.');
    }

    const audio = await ctx.req.arrayBuffer();
    if (audio.byteLength > MAX_BYTES) {
      throw new ApiError('BAD_REQUEST', 'That recording is too long. Keep it under a minute.');
    }
    if (audio.byteLength < 1000) {
      throw new ApiError('BAD_REQUEST', "I didn't hear anything. Tap the microphone and try again.");
    }

    if (!looksLikeAudio(new Uint8Array(audio, 0, Math.min(audio.byteLength, 16)))) {
      throw new ApiError('BAD_REQUEST', 'That recording could not be read. Please try again.');
    }

    const result = await transcribeAudio(audio, mime === 'audio/m4a' ? 'audio/mp4' : mime);
    if (result.ok) return { text: result.text };

    switch (result.reason) {
      case 'no_speech':
        throw new ApiError('BAD_REQUEST', "I didn't catch any words. Tap the microphone and try again.");
      case 'rejected_key':
        throw new ApiError('UPSTREAM_FAILED', 'The voice service rejected the server key. Ask an administrator to check GEMINI_API_KEY.', {
          internal: result.detail,
        });
      default:
        throw new ApiError('UPSTREAM_FAILED', 'The voice service is not responding right now. Please try again or type instead.', {
          internal: result.detail,
        });
    }
  },
);

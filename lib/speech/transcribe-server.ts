/**
 * SERVER-SIDE SPEECH-TO-TEXT (Gemini)
 *
 * Browser speech recognition (Web Speech API) streams audio to the browser
 * vendor's cloud. In Brave, Opera, Vivaldi, app-embedded browsers, Firefox,
 * or behind firewalls/VPNs that block that cloud, it fails with a "network"
 * error even though the internet works. This module is LIVE's own fallback:
 * the browser records a short clip and LIVE's server transcribes it with the
 * Gemini API using the server-only GEMINI_API_KEY.
 *
 * Audio is sent to Gemini for transcription only and is never stored by LIVE.
 */
import 'server-only';

const TIMEOUT_MS = 20_000;

/** Models tried in order; the first one this key can use wins (cached). */
function candidateModels(): string[] {
  const configured = process.env.GEMINI_SPEECH_MODEL?.trim();
  const list = [configured, 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'].filter(Boolean) as string[];
  return [...new Set(list)];
}
let workingModel: string | null = null;

export function speechServiceConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/aac',
  'audio/flac',
] as const;

/** True when the bytes really look like an audio file (not just labelled as one). */
export function looksLikeAudio(bytes: Uint8Array): boolean {
  const ascii = (start: number, text: string) =>
    [...text].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));
  if (bytes.length < 12) return false;
  return (
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) || // WebM / Matroska
    ascii(0, 'OggS') ||
    (ascii(0, 'RIFF') && ascii(8, 'WAVE')) ||
    ascii(4, 'ftyp') || // MP4 / M4A
    ascii(0, 'ID3') ||
    ascii(0, 'fLaC') ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) // MPEG / AAC frame sync
  );
}

export type TranscribeResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: 'not_configured' | 'rejected_key' | 'unavailable' | 'no_speech'; detail?: string };

const PROMPT = [
  'Transcribe the speech in this audio recording exactly as spoken.',
  'The speaker is most likely in South Africa and may use South African English, Afrikaans, isiZulu or other South African languages; transcribe in the language spoken.',
  'Return ONLY the transcript text, with normal punctuation and capitalisation. No quotes, labels, timestamps or commentary.',
  'If there is no intelligible speech, return exactly: [no speech]',
].join(' ');

export async function transcribeAudio(audio: ArrayBuffer, mimeType: string): Promise<TranscribeResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: 'not_configured' };

  const data = Buffer.from(audio).toString('base64');
  const models = workingModel ? [workingModel, ...candidateModels().filter((m) => m !== workingModel)] : candidateModels();
  let lastDetail = '';

  for (const model of models) {
    try {
      const response = await fetch(
        `${(process.env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ inlineData: { mimeType, data } }, { text: PROMPT }],
              },
            ],
            generationConfig: { temperature: 0, maxOutputTokens: 400 },
          }),
        },
      );

      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'rejected_key', detail: `HTTP ${response.status}` };
      }
      if (response.status === 404 || response.status === 400) {
        // Model not available for this key, or it cannot take audio: try the next one.
        lastDetail = `${model}: HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        lastDetail = `${model}: HTTP ${response.status}`;
        continue;
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim()
        .replace(/^["“']|["”']$/g, '');

      workingModel = model;
      if (!text || /^\[?no speech\]?\.?$/i.test(text)) return { ok: false, reason: 'no_speech' };
      return { ok: true, text: text.slice(0, 2000), model };
    } catch (error) {
      lastDetail = `${model}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { ok: false, reason: 'unavailable', detail: lastDetail };
}

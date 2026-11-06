import { z } from 'zod';

import { createHandler } from '@/lib/middleware/api/handler';
import { ApiError } from '@/lib/middleware/errors';
import { db } from '@/lib/middleware/server/db';
import { assertRequesterRequestAccess } from '@/lib/middleware/server/requester-request-access';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  answers: z.array(z.object({
    question_key: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().max(1000).nullable(),
    skipped: z.boolean(),
    source: z.enum(['request_help', 'ai_assistant']),
  }).refine((item) => item.skipped ? item.answer === null : Boolean(item.answer?.trim()), {
    message: 'Provide an answer or mark this question as skipped.',
  })).min(1).max(10),
});

export const GET = createHandler(
  { name: 'requester.intake_answers.list', auth: 'required', roles: ['requester', 'dispatcher', 'admin'], params: paramsSchema },
  async (ctx) => {
    const request = await assertRequesterRequestAccess(ctx.params.id, ctx.user);
    const { data, error } = await db()
      .from('emergency_intake_answers')
      .select('request_id, question_key, question, answer, skipped, source, updated_at')
      .eq('request_id', request.id)
      .order('created_at', { ascending: true });
    if (error) throw ApiError.internal('Unable to load emergency answers.', error.message);
    return { answers: data ?? [] };
  },
);

export const POST = createHandler(
  { name: 'requester.intake_answers.save', auth: 'required', roles: ['requester'], params: paramsSchema, body: bodySchema },
  async (ctx) => {
    const request = await assertRequesterRequestAccess(ctx.params.id, ctx.user);
    const now = new Date().toISOString();
    const rows = ctx.body.answers.map((item) => ({
      request_id: request.id,
      requester_id: ctx.user.userId,
      updated_by_user_id: ctx.user.userId,
      question_key: item.question_key,
      question: item.question,
      answer: item.skipped ? null : item.answer,
      skipped: item.skipped,
      source: item.source,
      updated_at: now,
    }));

    const { data, error } = await db()
      .from('emergency_intake_answers')
      .upsert(rows, { onConflict: 'request_id,question_key' })
      .select('request_id, question_key, question, answer, skipped, source, updated_at');
    if (error) throw ApiError.internal('Unable to save emergency answers.', error.message);
    return { answers: data ?? [] };
  },
);

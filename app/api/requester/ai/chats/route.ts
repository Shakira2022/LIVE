import { z } from 'zod';

import { createHandler } from '@/lib/middleware/api/handler';
import { ApiError } from '@/lib/middleware/errors';
import { db } from '@/lib/middleware/server/db';
import { assertRequesterRequestAccess } from '@/lib/middleware/server/requester-request-access';

export const runtime = 'nodejs';

const querySchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
});

const bodySchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  messages: z.array(z.object({
    id: z.string().uuid(),
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4000),
    provider: z.string().max(80).nullable().optional(),
    model: z.string().max(120).nullable().optional(),
  })).length(2).refine((items) => items[0]?.role === 'user' && items[1]?.role === 'assistant', {
    message: 'A saved chat turn must contain a user message followed by an assistant reply.',
  }),
});

export const GET = createHandler(
  { name: 'requester.ai_chats.list', auth: 'required', roles: ['requester'], query: querySchema },
  async (ctx) => {
    const { requestId, conversationId } = ctx.query;
    await assertRequesterRequestAccess(requestId, ctx.user);

    if (conversationId) {
      const { data: conversation, error: conversationError } = await db()
        .from('requester_ai_conversations')
        .select('id, request_id, title, created_at, updated_at')
        .eq('id', conversationId)
        .eq('request_id', requestId)
        .eq('requester_id', ctx.user.userId)
        .maybeSingle();
      if (conversationError) throw ApiError.internal('Unable to load this chat.', conversationError.message);
      if (!conversation) throw ApiError.notFound('This chat does not exist for the selected emergency.');

      const { data: messages, error: messageError } = await db()
        .from('requester_ai_messages')
        .select('id, role, content, provider, model, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (messageError) throw ApiError.internal('Unable to load chat messages.', messageError.message);
      return { conversation: { ...conversation, messages: messages ?? [] } };
    }

    const { data, error } = await db()
      .from('requester_ai_conversations')
      .select('id, request_id, title, created_at, updated_at')
      .eq('request_id', requestId)
      .eq('requester_id', ctx.user.userId)
      .order('updated_at', { ascending: false })
      .limit(1000);
    if (error) throw ApiError.internal('Unable to load chat history.', error.message);
    return { conversations: data ?? [] };
  },
);

export const POST = createHandler(
  { name: 'requester.ai_chats.save', auth: 'required', roles: ['requester'], body: bodySchema, rateLimit: { limit: 60, windowMs: 60_000, by: 'user' } },
  async (ctx) => {
    const { requestId, conversationId, title, messages } = ctx.body;
    await assertRequesterRequestAccess(requestId, ctx.user);

    const { data: existing, error: existingError } = await db()
      .from('requester_ai_conversations')
      .select('id, request_id, requester_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (existingError) throw ApiError.internal('Unable to verify this chat.', existingError.message);
    if (existing && (existing.request_id !== requestId || existing.requester_id !== ctx.user.userId)) throw ApiError.notFound();

    const now = new Date().toISOString();
    const { error: conversationError } = await db()
      .from('requester_ai_conversations')
      .upsert({
        id: conversationId,
        request_id: requestId,
        requester_id: ctx.user.userId,
        title,
        updated_at: now,
      }, { onConflict: 'id' });
    if (conversationError) throw ApiError.internal('Unable to save this chat.', conversationError.message);

    const messageTime = Date.now();
    const rows = messages.map((message, index) => ({
      id: message.id,
      conversation_id: conversationId,
      request_id: requestId,
      requester_id: ctx.user.userId,
      role: message.role,
      content: message.content,
      provider: message.provider ?? null,
      model: message.model ?? null,
      created_at: new Date(messageTime + index).toISOString(),
    }));
    const { error: messagesError } = await db()
      .from('requester_ai_messages')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (messagesError) throw ApiError.internal('The chat was created, but its messages could not be saved.', messagesError.message);

    return { conversationId, title, updatedAt: now };
  },
);

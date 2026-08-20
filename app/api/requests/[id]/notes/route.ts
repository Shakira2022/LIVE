/**
 * POST /api/requests/[id]/notes   (Block 6, Person 12)
 *
 * requesterVisible defaults to false: an operational note stays internal unless
 * staff deliberately share it. getRequestDetail() filters on the same flag.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { idParamSchema, noteSchema } from '@/lib/middleware/validation';
import { addNote } from '@/lib/middleware/server/requests-service';

export const runtime = 'nodejs';

export const POST = createHandler(
  {
    name: 'requests.note',
    auth: 'required',
    roles: ['responder', 'dispatcher', 'admin'],
    params: idParamSchema,
    body: noteSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.note_added', targetType: 'emergency_request' },
    successStatus: 201,
  },
  async (ctx) => {
    const note = await addNote(ctx.params.id, ctx.user, ctx.body);
    ctx.audit({ targetId: ctx.params.id, noteId: note.id, requesterVisible: note.requesterVisible });
    return note;
  },
);

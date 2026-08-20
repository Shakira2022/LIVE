/**
 * GET /api/health   (Block 7, Person 6 - ngrok / phone testing)
 *
 * Cheap liveness probe. It confirms the process is up and that the environment
 * validated, WITHOUT touching the database, so it stays usable as a smoke test
 * when Supabase itself is the thing that is down.
 */

import { createHandler } from '@/lib/middleware/api/handler';

export const runtime = 'nodejs';

export const GET = createHandler({ name: 'health', auth: 'none' }, async () => ({
  status: 'ok',
  service: 'live-response-middleware',
  time: new Date().toISOString(),
}));

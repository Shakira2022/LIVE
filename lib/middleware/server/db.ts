/**
 * SUPABASE SERVICE-ROLE CLIENT FOR THE MIDDLEWARE LAYER
 *
 * SERVER ONLY. The service role key bypasses RLS, so this module must never be
 * imported from a client component. Every read and write is expected to have
 * already passed the authorisation stage in lib/middleware/api/handler.ts.
 *
 * Ported from emergency-response/src/lib/server/supabase.ts.
 * CHANGED FOR LIVE: the client is created lazily instead of at module load, so
 * importing this file cannot crash a build when .env.local is absent. The
 * existing lib/supabase-server.ts throws at import time; leave it in place for
 * the code that already uses it, but new middleware code should use db().
 */

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/middleware/env';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application': 'live-response-middleware' } },
    });
  }
  return client;
}

/** Postgres error codes we translate into domain errors. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  RAISE_EXCEPTION: 'P0001',
  NO_DATA_FOUND: 'P0002',
} as const;

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === PG.UNIQUE_VIOLATION;
}

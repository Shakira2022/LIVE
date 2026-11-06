import 'server-only';

import type { AuthPrincipal } from '@/types';
import { ApiError } from '@/lib/middleware/errors';
import { db } from '@/lib/middleware/server/db';

export async function assertRequesterRequestAccess(requestId: string, auth: AuthPrincipal) {
  const { data, error } = await db()
    .from('emergency_requests')
    .select('id, requester_id, routed_organisation_id')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw ApiError.internal('Unable to verify emergency request access.', error.message);
  if (!data) throw ApiError.notFound();

  if (auth.role === 'requester' && data.requester_id === auth.userId) return data;
  if (auth.role === 'admin') return data;
  if (
    auth.role === 'dispatcher' &&
    (!data.routed_organisation_id || data.routed_organisation_id === auth.organisationId)
  ) return data;

  throw ApiError.notFound();
}

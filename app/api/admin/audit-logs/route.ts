/**
 * GET /api/admin/audit-logs   (Block 8, Person 10 - test evidence)
 *
 * Read-only audit trail for admins and auditors. This is what the auditor
 * screens in app/app/auditor read, and what Person 10 exports as evidence for
 * the handover pack.
 */

import { createHandler } from '@/lib/middleware/api/handler';
import { auditQuerySchema } from '@/lib/middleware/validation';
import { db } from '@/lib/middleware/server/db';
import { ApiError } from '@/lib/middleware/errors';
import type { AuditLogEntry } from '@/types';

export const runtime = 'nodejs';

export const GET = createHandler(
  {
    name: 'admin.audit_logs',
    auth: 'required',
    roles: ['admin', 'auditor'],
    query: auditQuerySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: 'user' },
  },
  async (ctx) => {
    let query = db()
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(ctx.query.offset, ctx.query.offset + ctx.query.limit - 1);

    if (ctx.query.action) query = query.ilike('action', `%${ctx.query.action}%`);
    if (ctx.query.targetType) query = query.eq('target_type', ctx.query.targetType);
    if (ctx.query.result) query = query.eq('result', ctx.query.result);

    const { data, error, count } = await query;
    if (error) throw ApiError.internal('Could not load the audit log.', error.message);

    const items: AuditLogEntry[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      actorUserId: (row.actor_user_id as string | null) ?? null,
      actorRole: row.actor_role as AuditLogEntry['actorRole'],
      organisationId: (row.organisation_id as string | null) ?? null,
      action: row.action as string,
      targetType: row.target_type as string,
      targetId: (row.target_id as string | null) ?? null,
      requestId: (row.request_id as string | null) ?? null,
      correlationId: row.correlation_id as string,
      result: row.result as AuditLogEntry['result'],
      safeMetadata: (row.safe_metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    }));

    return { items, total: count ?? 0, limit: ctx.query.limit, offset: ctx.query.offset };
  },
);

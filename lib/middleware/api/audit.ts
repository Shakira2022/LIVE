/**
 * AUDIT AND SECURITY EVENT WRITER  (Block 2 Person 8, Block 5 Person 10, Block 6 Person 2)
 *
 * Two destinations for every event:
 *   1. A structured JSON log line (searchable in hosting logs).
 *   2. A durable row, queryable by admins and auditors.
 *
 * Writing an audit row must never break the operation it describes, so
 * failures here are logged and swallowed.
 *
 * Ported from emergency-response/src/lib/api/audit.ts.
 * CHANGED FOR LIVE - the deployed schema splits what emergency-response kept in
 * one table:
 *   - audit_logs        business actions       (actor_user_id, safe_metadata, ...)
 *   - security_logs     auth / access events   (user_id, event_type, ...)
 *   - application_logs  operational events     (level, service_name, ...)
 * `logType` therefore chooses the destination TABLE instead of filling a
 * log_type column. Column mapping vs emergency-response:
 *   actor_id -> actor_user_id | metadata -> safe_metadata | ip_hash -> dropped
 *   (that column is inet in LIVE; the hash goes into safe_metadata.ipHash).
 * `result` must be one of the audit_result enum values.
 */

import { db } from '@/lib/middleware/server/db';
import { createLogger, redact, type LogType } from '@/lib/middleware/logger';
import type { AuditResult, UserRole } from '@/types';

export interface AuditEvent {
  logType?: LogType;
  actorId?: string | null;
  actorRole?: UserRole | null;
  organisationId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Only set this when the target really is an emergency_requests.id (it is a FK). */
  requestId?: string | null;
  correlationId?: string | null;
  result?: AuditResult;
  ipHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

const auditLogger = createLogger({ logType: 'audit' });

/** correlation_id is a uuid column, so a non-uuid trace id must not be sent. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuid(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

export async function writeAudit(event: AuditEvent): Promise<void> {
  const logType = event.logType ?? 'audit';
  const result: AuditResult = event.result ?? 'success';
  const safeMetadata: Record<string, unknown> = {
    ...((redact(event.metadata ?? {}) as Record<string, unknown>) ?? {}),
    ...(event.ipHash ? { ipHash: event.ipHash } : {}),
    ...(event.correlationId && !asUuid(event.correlationId)
      ? { traceId: event.correlationId }
      : {}),
  };

  auditLogger.info(event.action, {
    logType,
    requestId: event.correlationId ?? undefined,
    userId: event.actorId ?? undefined,
    role: event.actorRole ?? undefined,
    result,
    target: `${event.targetType ?? '-'}:${event.targetId ?? '-'}`,
    metadata: event.metadata,
  });

  try {
    if (logType === 'security') {
      const { error } = await db()
        .from('security_logs')
        .insert({
          user_id: event.actorId ?? null,
          event_type: event.action,
          result,
          ...(asUuid(event.correlationId) ? { correlation_id: asUuid(event.correlationId) } : {}),
          user_agent: event.userAgent ?? null,
          safe_metadata: safeMetadata,
        });
      if (error) {
        auditLogger.error('security_log_write_failed', {
          action: event.action,
          dbError: error.message,
        });
      }
      return;
    }

    if (logType === 'application' || logType === 'integration') {
      const { error } = await db()
        .from('application_logs')
        .insert({
          level: result === 'success' ? 'info' : 'warning',
          service_name: 'middleware',
          event_name: event.action,
          message: `${event.targetType ?? 'event'}:${event.targetId ?? '-'}`,
          request_id: asUuid(event.requestId),
          correlation_id: asUuid(event.correlationId),
          safe_context: safeMetadata,
        });
      if (error) {
        auditLogger.error('application_log_write_failed', {
          action: event.action,
          dbError: error.message,
        });
      }
      return;
    }

    const { error } = await db()
      .from('audit_logs')
      .insert({
        actor_user_id: event.actorId ?? null,
        actor_role: event.actorRole ?? null,
        organisation_id: event.organisationId ?? null,
        action: event.action,
        target_type: event.targetType ?? 'system',
        target_id: event.targetId ?? null,
        request_id: asUuid(event.requestId),
        ...(asUuid(event.correlationId) ? { correlation_id: asUuid(event.correlationId) } : {}),
        result,
        user_agent: event.userAgent ?? null,
        safe_metadata: safeMetadata,
      });
    if (error) {
      auditLogger.error('audit_write_failed', { action: event.action, dbError: error.message });
    }
  } catch (error) {
    auditLogger.error('audit_write_threw', { action: event.action, cause: String(error) });
  }
}

/** Security-log convenience wrapper for authentication events (Block 2 Person 8). */
export function writeSecurityEvent(event: Omit<AuditEvent, 'logType'>): Promise<void> {
  return writeAudit({ ...event, logType: 'security' });
}

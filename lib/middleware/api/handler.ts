/**
 * THE API MIDDLEWARE PIPELINE.
 *
 * Every route handler in src/app/api is wrapped by createHandler(). The
 * wrapper runs the cross-cutting concerns from SRS 7.2 in a fixed order so no
 * individual route can forget one of them:
 *
 *   1. Request context   - correlation id, client IP hash, user agent, timer
 *   2. Security headers  - applied to success and failure alike
 *   3. Rate limiting     - per IP, per user, or both
 *   4. Authentication    - verify the JWT (cookie or Authorization header)
 *   5. Authorisation     - role check, then per-route ownership checks
 *   6. Validation        - Zod over params, query and body
 *   7. Handler           - the route's own business logic
 *   8. Error handling    - safe client message, detailed internal log
 *   9. Audit             - one durable row per meaningful action
 *
 * A route describes what it needs; it never re-implements any of it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { AuditResult, AuthPrincipal, UserRole } from '@/types';
import { ApiError, isApiError } from '@/lib/middleware/errors';
import { createLogger, type Logger } from '@/lib/middleware/logger';
import { serverEnv, COOKIE_ACCESS } from '@/lib/middleware/env';
import { bearerFromHeader, tokenError, verifyAccessToken, type JwtConfig } from '@/lib/middleware/jwt';
import { applySecurityHeaders, jsonError, jsonOk } from '@/lib/middleware/api/response';
import { checkRateLimit, type RateLimitRule } from '@/lib/middleware/api/rate-limit';
import { clientIp, hashIp, resolveRequestId, userAgent } from '@/lib/middleware/api/context';
import { writeAudit, type AuditEvent } from '@/lib/middleware/api/audit';

export function jwtConfig(): JwtConfig {
  return {
    secret: serverEnv.jwtSecret,
    issuer: serverEnv.jwtIssuer,
    audience: serverEnv.jwtAudience,
  };
}

type MaybeSchema = z.ZodTypeAny | undefined;
type Infer<S extends MaybeSchema> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

export interface HandlerContext<B, Q, P> {
  req: NextRequest;
  body: B;
  query: Q;
  params: P;
  /** Present whenever auth is 'required'; null only when auth is 'optional'. */
  auth: AuthPrincipal | null;
  /** Non-null assertion helper for routes that declared auth: 'required'. */
  user: AuthPrincipal;
  requestId: string;
  ipHash: string;
  userAgent: string;
  log: Logger;
  /** Attach extra fields to the audit row this route will write. */
  audit(metadata: Record<string, unknown>): void;
}

export interface RouteConfig<B extends MaybeSchema, Q extends MaybeSchema, P extends MaybeSchema> {
  /** Short stable name used in logs, audit rows and rate-limit keys. */
  name: string;
  auth?: 'required' | 'optional' | 'none';
  roles?: UserRole[];
  rateLimit?: RateLimitRule;
  body?: B;
  query?: Q;
  params?: P;
  audit?: { action: string; targetType?: string; logType?: AuditEvent['logType'] };
  /** Success status code. Defaults to 200. */
  successStatus?: number;
}

function formatZodIssues(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown, where: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError('VALIDATION_FAILED', `Check the ${where} and try again.`, {
      details: formatZodIssues(result.error),
    });
  }
  return result.data;
}

async function readJsonBody(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError('BAD_REQUEST', 'Send this request as application/json.');
  }
  try {
    return await req.json();
  } catch {
    throw new ApiError('BAD_REQUEST', 'The request body is not valid JSON.');
  }
}

/** Step 4: pull the access token from a cookie or an Authorization header. */
function extractAccessToken(req: NextRequest): string | null {
  const header = bearerFromHeader(req.headers.get('authorization'));
  if (header) return header;
  return req.cookies.get(COOKIE_ACCESS)?.value ?? null;
}

async function authenticate(req: NextRequest): Promise<AuthPrincipal> {
  const token = extractAccessToken(req);
  if (!token) throw ApiError.unauthenticated();

  const outcome = await verifyAccessToken(jwtConfig(), token);
  if (!outcome.valid) throw tokenError(outcome.reason);

  return {
    userId: outcome.claims.sub,
    role: outcome.claims.role,
    organisationId: outcome.claims.org ?? null,
    tokenId: outcome.claims.jti,
    expiresAt: outcome.claims.exp,
  };
}

export function createHandler<
  B extends MaybeSchema = undefined,
  Q extends MaybeSchema = undefined,
  P extends MaybeSchema = undefined,
>(
  config: RouteConfig<B, Q, P>,
  handler: (ctx: HandlerContext<Infer<B>, Infer<Q>, Infer<P>>) => Promise<unknown>,
) {
  return async function route(
    req: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> {
    const startedAt = Date.now();
    const requestId = resolveRequestId(req);          // 1. request context
    const ip = clientIp(req);
    const ua = userAgent(req);
    const ipHash = await hashIp(ip, serverEnv.jwtSecret);
    const log = createLogger({
      requestId,
      route: config.name,
      method: req.method,
      logType: 'application',
    });

    let principal: AuthPrincipal | null = null;
    const auditExtras: Record<string, unknown> = {};

    try {
      // 3. rate limiting (before any database work)
      if (config.rateLimit && serverEnv.rateLimitEnabled) {
        // A user-scoped limit needs the identity first, so peek at the token
        // without failing here - the auth step below produces the real error.
        if (config.rateLimit.by !== 'ip') {
          const token = extractAccessToken(req);
          if (token) {
            const peek = await verifyAccessToken(jwtConfig(), token);
            if (peek.valid) {
              principal = {
                userId: peek.claims.sub,
                role: peek.claims.role,
                organisationId: peek.claims.org ?? null,
                tokenId: peek.claims.jti,
                expiresAt: peek.claims.exp,
              };
            }
          }
        }
        const by = config.rateLimit.by ?? 'ip';
        const subject =
          by === 'ip' ? ipHash
          : by === 'user' ? (principal?.userId ?? ipHash)
          : `${ipHash}:${principal?.userId ?? 'anon'}`;
        const verdict = checkRateLimit(`${config.name}:${subject}`, config.rateLimit);

        if (!verdict.allowed) {
          log.warn('rate_limited', { logType: 'security', userId: principal?.userId });
          await writeAudit({
            logType: 'security',
            action: `${config.name}.rate_limited`,
            actorId: principal?.userId ?? null,
            actorRole: principal?.role ?? null,
            correlationId: requestId,
            result: 'denied',
            ipHash,
            userAgent: ua,
            metadata: { limit: verdict.limit, windowMs: config.rateLimit.windowMs },
          });
          const res = jsonError(
            429,
            'RATE_LIMITED',
            'Too many attempts. Wait a moment and try again.',
            requestId,
          );
          res.headers.set('Retry-After', String(verdict.retryAfterSeconds));
          res.headers.set('X-RateLimit-Limit', String(verdict.limit));
          res.headers.set('X-RateLimit-Remaining', '0');
          return res;
        }
      }

      // 4. authentication
      const mode = config.auth ?? 'required';
      if (mode === 'required') {
        principal = await authenticate(req);
      } else if (mode === 'optional' && !principal) {
        try {
          principal = await authenticate(req);
        } catch {
          principal = null;
        }
      }

      // 5. authorisation (role gate; ownership is checked inside each route)
      if (config.roles && config.roles.length > 0) {
        if (!principal || !config.roles.includes(principal.role)) {
          await writeAudit({
            logType: 'security',
            action: `${config.name}.forbidden`,
            actorId: principal?.userId ?? null,
            actorRole: principal?.role ?? null,
            correlationId: requestId,
            result: 'denied',
            ipHash,
            userAgent: ua,
            metadata: { requiredRoles: config.roles },
          });
          throw ApiError.forbidden();
        }
      }

      // 6. validation
      // Next 15+ hands dynamic route params over as a Promise, so they must be
      // awaited before validation. (Next 14 passed a plain object.)
      const rawParams = (await routeContext?.params) ?? {};
      const params = (config.params
        ? parseOrThrow(config.params, rawParams, 'address')
        : rawParams) as Infer<P>;

      const query = (config.query
        ? parseOrThrow(
            config.query,
            Object.fromEntries(new URL(req.url).searchParams.entries()),
            'filters',
          )
        : undefined) as Infer<Q>;

      const body = (config.body
        ? parseOrThrow(config.body, await readJsonBody(req), 'form')
        : undefined) as Infer<B>;

      // 7. handler
      const result = await handler({
        req,
        body,
        query,
        params,
        auth: principal,
        get user() {
          if (!principal) {
            throw ApiError.unauthenticated();
          }
          return principal;
        },
        requestId,
        ipHash,
        userAgent: ua,
        log: log.child({ userId: principal?.userId, role: principal?.role }),
        audit(metadata) {
          Object.assign(auditExtras, metadata);
        },
      });

      const response =
        result instanceof NextResponse
          ? applySecurityHeaders(result)
          : jsonOk(result, requestId, { status: config.successStatus ?? 200 });

      const durationMs = Date.now() - startedAt;
      log.info('request_completed', {
        status: response.status,
        durationMs,
        userId: principal?.userId,
        role: principal?.role,
      });

      // 9. audit
      if (config.audit) {
        await writeAudit({
          logType: config.audit.logType ?? 'audit',
          action: config.audit.action,
          actorId: principal?.userId ?? null,
          actorRole: principal?.role ?? null,
          targetType: config.audit.targetType ?? null,
          targetId: (auditExtras.targetId as string | undefined) ?? null,
          correlationId: requestId,
          result: 'success',
          ipHash,
          userAgent: ua,
          metadata: auditExtras,
        });
      }

      return response;
    } catch (error) {
      // 8. error handling
      const durationMs = Date.now() - startedAt;

      if (isApiError(error)) {
        const level = error.status >= 500 ? 'error' : 'warn';
        log[level]('request_failed', {
          logType: error.status === 401 || error.status === 403 ? 'security' : 'application',
          status: error.status,
          code: error.code,
          durationMs,
          userId: principal?.userId,
          internal: error.internal,
        });

        if (config.audit) {
          await writeAudit({
            logType: config.audit.logType ?? 'audit',
            action: config.audit.action,
            actorId: principal?.userId ?? null,
            actorRole: principal?.role ?? null,
            targetType: config.audit.targetType ?? null,
            targetId: (auditExtras.targetId as string | undefined) ?? null,
            correlationId: requestId,
            result: (error.status === 403 ? 'denied' : 'failure') as AuditResult,
            ipHash,
            userAgent: ua,
            metadata: { ...auditExtras, code: error.code },
          });
        }

        return jsonError(error.status, error.code, error.message, requestId, error.details);
      }

      // Anything unexpected: log fully, tell the client almost nothing.
      log.error('unhandled_exception', {
        durationMs,
        userId: principal?.userId,
        cause: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
      });

      return jsonError(
        500,
        'INTERNAL_ERROR',
        'Something went wrong on the server. The reference below helps us trace it.',
        requestId,
      );
    }
  };
}

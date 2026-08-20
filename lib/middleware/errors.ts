/**
 * Error taxonomy.
 *
 * Middleware turns every thrown ApiError into a safe client message while the
 * detailed cause is written to the application log (SRS 7.2 "Error handling":
 * return safe client messages while recording detailed internal information).
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STATUS_TRANSITION_INVALID'
  | 'DUPLICATE_REQUEST'
  | 'RATE_LIMITED'
  | 'UPSTREAM_FAILED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STATUS_TRANSITION_INVALID: 409,
  DUPLICATE_REQUEST: 409,
  RATE_LIMITED: 429,
  UPSTREAM_FAILED: 502,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Written to the log only. Never returned to the browser. */
  readonly internal?: unknown;

  constructor(code: ErrorCode, message: string, options?: { details?: unknown; internal?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options?.details;
    this.internal = options?.internal;
  }

  static unauthenticated(message = 'Sign in to continue.') {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to do this.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'That record does not exist or is not visible to you.') {
    return new ApiError('NOT_FOUND', message);
  }
  static internal(message = 'Something went wrong on the server.', internal?: unknown) {
    return new ApiError('INTERNAL_ERROR', message, { internal });
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * BROWSER API CLIENT   (Block 3, Persons 1 and 2)
 *
 * One place where the frontend talks to the middleware. It exists so that no
 * component has to know about the envelope, the 401-then-refresh dance, or the
 * correlation id.
 *
 * Ported from emergency-response/src/lib/client/api.ts and adapted to this
 * project's envelope.
 */

'use client';

import type { ApiResult } from '@/types';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId: string;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId: string;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /** Field name -> messages, for rendering inline under form inputs. */
  get fieldErrors(): Record<string, string[]> {
    return (this.details as Record<string, string[]>) ?? {};
  }
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  retryOnExpiry?: boolean;
}

async function parse<T>(response: Response): Promise<ApiResult<T>> {
  try {
    return (await response.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The server sent a response we could not read.' },
      requestId: response.headers.get('x-request-id') ?? 'unknown',
    };
  }
}

export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, retryOnExpiry = true } = options;

  const response = await fetch(path, {
    method,
    signal,
    // httpOnly cookies carry the session; nothing is read from localStorage.
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parse<T>(response);

  if (payload.ok) return payload.data;

  // A short-lived access token expiring mid-session is normal, not an error.
  // Renew once and replay the original call.
  if (payload.error.code === 'TOKEN_EXPIRED' && retryOnExpiry) {
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (refreshed.ok) {
      return api<T>(path, { ...options, retryOnExpiry: false });
    }
  }

  throw new ApiClientError({
    code: payload.error.code,
    message: payload.error.message,
    status: response.status,
    details: payload.error.details,
    requestId: payload.requestId,
  });
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });

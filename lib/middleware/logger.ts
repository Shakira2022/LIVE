/**
 * Structured logging (SRS 7.3).
 *
 * Four log types are emitted as single-line JSON so that hosting log search
 * can filter them: security, audit, application, integration.
 *
 * Redaction is applied before anything is written. Passwords, raw tokens,
 * signing keys and full contact numbers must never reach a log line.
 */

export type LogType = 'security' | 'audit' | 'application' | 'integration';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = [
  'password', 'passwordhash', 'password_hash', 'confirmpassword',
  'token', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token',
  'authorization', 'cookie', 'secret', 'jwtsecret', 'servicerolekey',
  'apikey', 'api_key', 'signingkey', 'privatekey',
];

const MASK_KEYS = ['phone', 'callbacknumber', 'callback_number', 'emergencycontactphone', 'email'];

function maskIdentifier(value: string): string {
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return value.length <= 4 ? '***' : `***${value.slice(-4)}`;
}

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));
  if (input instanceof Error) return { name: input.name, message: input.message };
  if (typeof input !== 'object') return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalised = key.toLowerCase().replace(/[-_]/g, '');
    if (REDACT_KEYS.includes(normalised)) {
      output[key] = '[redacted]';
    } else if (MASK_KEYS.includes(normalised) && typeof value === 'string') {
      output[key] = maskIdentifier(value);
    } else {
      output[key] = redact(value, depth + 1);
    }
  }
  return output;
}

export interface LogFields {
  logType?: LogType;
  requestId?: string;
  userId?: string;
  role?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  action?: string;
  result?: string;
  [key: string]: unknown;
}

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  return LEVEL_ORDER[raw] ? raw : 'info';
}

function emit(level: LogLevel, message: string, fields: LogFields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    logType: fields.logType ?? 'application',
    message,
    ...(redact(fields) as Record<string, unknown>),
  };
  const serialised = JSON.stringify(line);
  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bound: LogFields): Logger;
}

export function createLogger(bound: LogFields = {}): Logger {
  return {
    debug: (m, f) => emit('debug', m, { ...bound, ...f }),
    info: (m, f) => emit('info', m, { ...bound, ...f }),
    warn: (m, f) => emit('warn', m, { ...bound, ...f }),
    error: (m, f) => emit('error', m, { ...bound, ...f }),
    child: (extra) => createLogger({ ...bound, ...extra }),
  };
}

export const logger = createLogger();

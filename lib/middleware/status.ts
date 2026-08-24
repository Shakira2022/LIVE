/**
 * REQUEST LIFECYCLE RULES  (Block 5 / Block 6 / Block 7 Person 5)
 *
 * The browser is never trusted to decide which transition is legal. Every
 * status change is checked here on the server before it reaches Postgres.
 *
 * Ported from emergency-response/src/lib/status.ts.
 * CHANGED FOR LIVE:
 *   - 'rejected' added: it exists in the deployed emergency_status enum.
 *   - toDisplayStatus()/fromDisplayStatus() added, because the existing UI in
 *     lib/types.ts speaks Title Case ("En route") while the database speaks
 *     snake_case ('en_route'). Convert at the boundary, store snake_case.
 */

import type { RequestStatus, UserRole } from '@/types';

export const REQUEST_STATUSES: RequestStatus[] = [
  'submitted',
  'received',
  'assigned',
  'en_route',
  'arrived',
  'closed',
  'cancelled',
  'rejected',
];

export const TERMINAL_STATUSES: RequestStatus[] = ['closed', 'cancelled', 'rejected'];

/** Statuses a dispatcher treats as "still on my board". */
export const OPEN_STATUSES: RequestStatus[] = [
  'submitted',
  'received',
  'assigned',
  'en_route',
  'arrived',
];

/** Allowed next states from each state. */
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  submitted: ['received', 'cancelled', 'rejected'],
  received: ['assigned', 'closed', 'cancelled', 'rejected'],
  assigned: ['en_route', 'closed', 'cancelled'],
  en_route: ['arrived', 'closed', 'cancelled'],
  arrived: ['closed'],
  closed: [],
  cancelled: [],
  rejected: [],
};

/** Which roles may drive each transition. */
const ROLES_FOR_TARGET: Record<RequestStatus, UserRole[]> = {
  submitted: [],
  received: ['dispatcher', 'admin'],
  assigned: ['dispatcher', 'admin'],
  en_route: ['responder', 'dispatcher', 'admin'],
  arrived: ['responder', 'dispatcher', 'admin'],
  closed: ['dispatcher', 'admin'],
  cancelled: ['requester', 'dispatcher', 'admin'],
  rejected: ['dispatcher', 'admin'],
};

/**
 * The timestamp column each status stamps on emergency_requests. The deployed
 * schema keeps a dedicated column per milestone rather than deriving it from
 * history, so the service layer must set it on every transition.
 */
export const STATUS_TIMESTAMP_COLUMN: Partial<Record<RequestStatus, string>> = {
  received: 'received_at',
  assigned: 'assigned_at',
  en_route: 'en_route_at',
  arrived: 'arrived_at',
  closed: 'closed_at',
  cancelled: 'cancelled_at',
  rejected: 'rejected_at',
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransition(
  from: RequestStatus,
  to: RequestStatus,
  role: UserRole,
): TransitionCheck {
  if (from === to) {
    return { allowed: false, reason: `The request is already ${label(to)}.` };
  }
  if (TERMINAL_STATUSES.includes(from)) {
    return { allowed: false, reason: `A ${label(from)} request cannot change status again.` };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `${label(from)} cannot move straight to ${label(to)}. Allowed next: ${
        TRANSITIONS[from].map(label).join(', ') || 'none'
      }.`,
    };
  }
  if (!ROLES_FOR_TARGET[to].includes(role)) {
    return { allowed: false, reason: `Your role cannot set a request to ${label(to)}.` };
  }
  // A requester may only cancel before assignment. After assignment they must
  // REQUEST cancellation, which staff confirm.
  if (role === 'requester' && to === 'cancelled' && from !== 'submitted') {
    return {
      allowed: false,
      reason: 'A responder is already handling this request. Ask for cancellation instead.',
    };
  }
  return { allowed: true };
}

export function nextStatusesFor(from: RequestStatus, role: UserRole): RequestStatus[] {
  return TRANSITIONS[from].filter((to) => canTransition(from, to, role).allowed);
}

/* -------------------------------------------------------------------------- */
/* Display conversion - the bridge to the existing UI in lib/types.ts          */
/* -------------------------------------------------------------------------- */

const DISPLAY_BY_STATUS: Record<RequestStatus, string> = {
  submitted: 'Submitted',
  received: 'Received',
  assigned: 'Assigned',
  en_route: 'En route',
  arrived: 'Arrived',
  closed: 'Closed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

const STATUS_BY_DISPLAY: Record<string, RequestStatus> = Object.fromEntries(
  Object.entries(DISPLAY_BY_STATUS).map(([status, display]) => [
    display.toLowerCase(),
    status as RequestStatus,
  ]),
);

/** Database value -> the string the existing components already render. */
export function toDisplayStatus(status: RequestStatus): string {
  return DISPLAY_BY_STATUS[status];
}

/** UI string -> database value. Returns null for anything unrecognised. */
export function fromDisplayStatus(display: string): RequestStatus | null {
  return STATUS_BY_DISPLAY[display.trim().toLowerCase()] ?? null;
}

/** Alias of toDisplayStatus, kept because the ported code calls label(). */
export function label(status: RequestStatus): string {
  return DISPLAY_BY_STATUS[status];
}

/** Requester-facing wording. Never implies help is on the way before it is. */
export function statusExplanation(status: RequestStatus): string {
  switch (status) {
    case 'submitted':
      return 'Stored on the server. Dispatch has not confirmed it yet.';
    case 'received':
      return 'Dispatch has confirmed your request and is reviewing it.';
    case 'assigned':
      return 'A responder has been assigned to you.';
    case 'en_route':
      return 'The responder is travelling to your location.';
    case 'arrived':
      return 'The responder has reached your location.';
    case 'closed':
      return 'This request has been completed and closed.';
    case 'cancelled':
      return 'This request was cancelled. No responder is coming.';
    case 'rejected':
      return 'This request could not be accepted. Contact the emergency line directly.';
  }
}

/** Statuses during which the browser should keep polling for updates. */
export function shouldTrackLive(status: RequestStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

export type StatusTone = 'pending' | 'active' | 'resolved' | 'stopped';

export function statusTone(status: RequestStatus): StatusTone {
  if (status === 'submitted') return 'pending';
  if (status === 'cancelled' || status === 'rejected') return 'stopped';
  if (status === 'closed') return 'resolved';
  return 'active';
}

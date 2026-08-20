/**
 * SHARED TYPESCRIPT CONTRACT  (Block 1, Person 2)
 *
 * Frontend, middleware and backend all import from '@/types'. If a shape
 * changes here it must be agreed in the sync before parallel work continues.
 *
 * Ported from emergency-response/src/types/index.ts and reconciled with the
 * schema that is actually deployed to Supabase (supabase/schema.sql).
 *
 * Naming rule for this codebase:
 *   - The DATABASE uses snake_case lowercase enums ('en_route').
 *   - The API ENVELOPE uses camelCase fields and the same lowercase enums.
 *   - The EXISTING UI (lib/types.ts) uses Title Case display strings
 *     ("En route"). Convert at the boundary with the helpers in
 *     lib/middleware/status.ts - never store a display string.
 */

/* -------------------------------------------------------------------------- */
/* Enumerations - these mirror the Postgres enums exactly                      */
/* -------------------------------------------------------------------------- */

/** Postgres: app_user_role */
export type UserRole =
  | 'requester'
  | 'dispatcher'
  | 'responder'
  | 'admin'
  | 'auditor'
  | 'support';

/** Postgres: emergency_status */
export type RequestStatus =
  | 'submitted'
  | 'received'
  | 'assigned'
  | 'en_route'
  | 'arrived'
  | 'closed'
  | 'cancelled'
  | 'rejected';

/** Postgres: emergency_severity */
export type Severity = 'critical' | 'high' | 'moderate';

/** Postgres: location_method */
export type LocationMethod = 'gps' | 'manual' | 'map_pin';

/** Postgres: account_status */
export type AccountStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'locked'
  | 'deactivated';

/** Postgres: assignment_status */
export type AssignmentStatus =
  | 'assigned'
  | 'acknowledged'
  | 'en_route'
  | 'arrived'
  | 'completed'
  | 'cancelled'
  | 'rejected';

/** Postgres: audit_result */
export type AuditResult = 'success' | 'denied' | 'warning' | 'failure';

export type ActorKind = 'requester' | 'responder';

/** Roles that belong to an organisation and may act on other people's requests. */
export const STAFF_ROLES: UserRole[] = ['responder', 'dispatcher', 'admin'];

/* -------------------------------------------------------------------------- */
/* Token claims (Block 2)                                                      */
/* -------------------------------------------------------------------------- */

/** Claims carried inside the signed access token. Minimum set only. */
export interface AccessTokenClaims {
  sub: string; // user id
  role: UserRole;
  org: string | null; // organisation id for staff, null for requesters
  jti: string;
  typ: 'access';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  typ: 'refresh';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/** What every authenticated route handler receives after the pipeline runs. */
export interface AuthPrincipal {
  userId: string;
  role: UserRole;
  organisationId: string | null;
  tokenId: string;
  expiresAt: number;
}

/* -------------------------------------------------------------------------- */
/* API resources                                                               */
/* -------------------------------------------------------------------------- */

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  /** display_name, or "first last" when display_name is null. */
  fullName: string;
  initials: string;
  role: UserRole;
  status: AccountStatus;
  organisationId: string | null;
  organisationName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  previousStatus: RequestStatus | null;
  newStatus: RequestStatus;
  changedByUserId: string | null;
  actorRole: UserRole | null;
  changedBySystem: boolean;
  reason: string | null;
  note: string | null;
  correlationId: string;
  createdAt: string;
}

export interface Assignment {
  id: string;
  organisationId: string;
  responderUserId: string | null;
  responderName: string | null;
  teamId: string | null;
  teamName: string | null;
  vehicleId: string | null;
  vehicleCallSign: string | null;
  status: AssignmentStatus;
  etaMinutes: number | null;
  assignmentNote: string | null;
  assignedAt: string;
  acknowledgedAt: string | null;
  routeStartedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
}

export interface RequestLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  addressText: string | null;
  landmark: string | null;
  locationMethod: LocationMethod;
  capturedAt: string;
  confirmedAt: string | null;
}

export interface OperationalNote {
  id: string;
  authorUserId: string;
  authorName: string | null;
  note: string;
  requesterVisible: boolean;
  createdAt: string;
}

export interface EmergencyRequestSummary {
  id: string;
  reference: string; // emergency_requests.reference_code
  requesterId: string;
  requesterName: string | null;
  callbackNumber: string;
  category: string;
  severity: Severity;
  currentStatus: RequestStatus;
  isActive: boolean;
  isCancelled: boolean;
  etaMinutes: number | null;
  estimatedArrivalAt: string | null;
  organisationId: string | null;
  organisationName: string | null;
  location: RequestLocation | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface EmergencyRequestDetail extends EmergencyRequestSummary {
  note: string | null;
  receivedAt: string | null;
  assignedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  cancellationRequestedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  history: StatusHistoryEntry[];
  assignments: Assignment[];
  operationalNotes: OperationalNote[];
}

export interface AppNotification {
  id: string;
  recipientUserId: string;
  requestId: string | null;
  reference: string | null;
  notificationType: string;
  title: string;
  message: string;
  sensitivity: string;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorRole: UserRole | null;
  organisationId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  correlationId: string;
  result: AuditResult;
  safeMetadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionResponse {
  user: PublicUser;
  accessExpiresAt: number;
}

/* -------------------------------------------------------------------------- */
/* Uniform API envelope - EVERY endpoint returns this shape                    */
/* -------------------------------------------------------------------------- */

export type ApiSuccess<T> = { ok: true; data: T; requestId: string };

export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

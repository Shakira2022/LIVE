/**
 * EMERGENCY REQUEST SERVICE  (Blocks 4, 5 and 6)
 *
 * All request reads and writes go through here so that ownership, visibility
 * and status rules live in exactly one place. Route handlers stay thin.
 *
 * Ported from emergency-response/src/lib/server/requests-service.ts.
 * CHANGED FOR LIVE - schema reconciliation against supabase/schema.sql:
 *   reference                  -> reference_code
 *   organisation_id            -> routed_organisation_id
 *   lat/lon/accuracy_m on the request row
 *                              -> request_locations (1:1, unique request_id)
 *   location_source            -> request_locations.location_method
 *                                 ('gps' | 'manual' | 'map_pin')
 *   manual_address             -> request_locations.address_text
 *   cancellation_requested bool-> cancellation_requested_at timestamptz
 *   status_history.changed_by  -> changed_by_user_id
 *   status_history.changed_by_role -> actor_role
 *   assignments.assigned_to    -> responder_user_id (FK responder_profiles)
 *   assignments.team_label     -> team_id (FK responder_teams)
 *   assignments.vehicle_label  -> vehicle_id (FK vehicles)
 *   assignments.assigned_by    -> assigned_by_user_id (nullable for system assignment)
 *   assignments.notes          -> assignment_note
 *   severity                   -> NEW, required by the deployed schema
 *   per-status timestamp columns (received_at, assigned_at, ...) must be
 *   stamped on every transition; see STATUS_TIMESTAMP_COLUMN in status.ts.
 */

import 'server-only';
import { db, isUniqueViolation } from '@/lib/middleware/server/db';
import { ApiError } from '@/lib/middleware/errors';
import { generateReference } from '@/lib/middleware/reference';
import { canTransition, OPEN_STATUSES, STATUS_TIMESTAMP_COLUMN } from '@/lib/middleware/status';
import { chooseOrganisation, organisationTypesForEmergencyCategory, type RoutingDecision } from '@/lib/middleware/server/routing-service';
import { notifyOrganisationDispatchers, notifyRequestCancellationCompleted, notifyRespondersOfCancellationApproval } from '@/lib/notifications/service';
import type {
  Assignment,
  AuthPrincipal,
  EmergencyRequestDetail,
  EmergencyRequestSummary,
  OperationalNote,
  RequestLocation,
  RequestStatus,
  Severity,
  StatusHistoryEntry,
  UserRole,
} from '@/types';
import type {
  AssignmentInput,
  CreateRequestInput,
  LocationUpdateInput,
  NoteInput,
  StatusChangeInput,
} from '@/lib/middleware/validation';

/* -------------------------------------------------------------------------- */
/* Row shapes and projection                                                   */
/* -------------------------------------------------------------------------- */

const REQUEST_COLUMNS = `
  id, reference_code, requester_id, routed_organisation_id, category, severity, note,
  callback_number, current_status, is_active, is_cancelled, source, idempotency_key,
  client_request_id, estimated_arrival_at, eta_minutes, submitted_at, received_at,
  assigned_at, en_route_at, arrived_at, closed_at, cancellation_requested_at,
  cancelled_at, cancellation_reason, rejected_at, rejection_reason, created_at, updated_at,
  requester:users!emergency_requests_requester_id_fkey ( id, first_name, last_name, display_name ),
  organisation:organisations!emergency_requests_routed_organisation_id_fkey ( id, name ),
  request_locations ( latitude, longitude, accuracy_meters, address_text, landmark,
                      location_method, captured_at, confirmed_at )
`;

type NamedUser = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
} | null;

function nameOf(user: NamedUser): string | null {
  if (!user) return null;
  return user.display_name?.trim() || `${user.first_name} ${user.last_name}`.trim();
}

// Supabase's generated types are not wired up in this project, so the joined
// rows come back as `any`. Keep the casts contained to this one alias.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

function mapLocation(row: Row): RequestLocation | null {
  const loc = Array.isArray(row.request_locations)
    ? row.request_locations[0]
    : row.request_locations;
  if (!loc) return null;
  return {
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    accuracyMeters: loc.accuracy_meters === null ? null : Number(loc.accuracy_meters),
    addressText: loc.address_text ?? null,
    landmark: loc.landmark ?? null,
    locationMethod: loc.location_method,
    capturedAt: loc.captured_at,
    confirmedAt: loc.confirmed_at ?? null,
  };
}

function mapSummary(row: Row): EmergencyRequestSummary {
  return {
    id: row.id,
    reference: row.reference_code,
    requesterId: row.requester_id,
    requesterName: nameOf(row.requester ?? null),
    callbackNumber: row.callback_number,
    category: row.category,
    severity: row.severity as Severity,
    currentStatus: row.current_status as RequestStatus,
    isActive: row.is_active,
    isCancelled: row.is_cancelled,
    cancellationRequestedAt: row.cancellation_requested_at ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    cancelledAt: row.cancelled_at ?? null,
    etaMinutes: row.eta_minutes ?? null,
    estimatedArrivalAt: row.estimated_arrival_at ?? null,
    organisationId: row.routed_organisation_id ?? null,
    organisationName: row.organisation?.name ?? null,
    location: mapLocation(row),
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? null,
  };
}

function mapHistory(row: Row): StatusHistoryEntry {
  return {
    id: row.id,
    previousStatus: row.previous_status ?? null,
    newStatus: row.new_status,
    changedByUserId: row.changed_by_user_id ?? null,
    actorRole: row.actor_role ?? null,
    changedBySystem: row.changed_by_system,
    reason: row.reason ?? null,
    note: row.note ?? null,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

function mapAssignment(row: Row): Assignment {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    responderUserId: row.responder_user_id ?? null,
    responderName: nameOf(row.responder?.user ?? row.responder ?? null),
    responderEmployeeNumber: row.responder?.employee_number ?? null,
    assignedByName: nameOf(row.assigned_by ?? null),
    responderLatitude: row.responder?.current_latitude ?? null,
    responderLongitude: row.responder?.current_longitude ?? null,
    teamId: row.team_id ?? null,
    teamName: row.team?.name ?? null,
    vehicleId: row.vehicle_id ?? null,
    vehicleCallSign: row.vehicle?.call_sign ?? null,
    vehicleRegistrationNumber: row.vehicle?.registration_number ?? null,
    status: row.status,
    etaMinutes: row.eta_minutes ?? null,
    assignmentNote: row.assignment_note ?? null,
    assignedAt: row.assigned_at,
    acknowledgedAt: row.acknowledged_at ?? null,
    routeStartedAt: row.route_started_at ?? null,
    arrivedAt: row.arrived_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function mapNote(row: Row): OperationalNote {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorName: nameOf(row.author ?? null),
    note: row.note,
    requesterVisible: row.requester_visible,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* -------------------------------------------------------------------------- */
/* Visibility (Block 5 Person 9, Block 6 Person 1)                             */
/* -------------------------------------------------------------------------- */

/**
 * A requester may only ever see their OWN requests. Staff see their
 * organisation's requests; unrouted requests are visible to dispatch so that a
 * new request is never invisible. Admin and auditor see everything.
 */
export function assertCanView(request: EmergencyRequestSummary, auth: AuthPrincipal): void {
  if (auth.role === 'admin' || auth.role === 'auditor') return;

  if (auth.role === 'dispatcher') {
    // Dispatchers may open unrouted requests for triage, even if their account
    // has no active organisation membership yet. Routed requests remain scoped.
    if (request.organisationId && request.organisationId !== auth.organisationId) {
      throw ApiError.notFound();
    }
    return;
  }

  if (auth.role === 'requester') {
    if (request.requesterId !== auth.userId) throw ApiError.notFound();
    return;
  }

  // responder / dispatcher / support
  if (request.organisationId && request.organisationId !== auth.organisationId) {
    throw ApiError.notFound();
  }
}

export function assertCanAct(auth: AuthPrincipal, allowed: UserRole[]): void {
  if (!allowed.includes(auth.role)) throw ApiError.forbidden();
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface ListOptions {
  scope: 'new' | 'active' | 'completed' | 'mine' | 'all';
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export async function listRequests(
  auth: AuthPrincipal,
  options: ListOptions,
): Promise<{ items: EmergencyRequestSummary[]; total: number }> {
  let query = db()
    .from('emergency_requests')
    .select(REQUEST_COLUMNS, { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);

  // Ownership is applied in the query, not after it, so a requester can never
  // page through somebody else's rows.
  if (auth.role === 'dispatcher') {
    // Unrouted requests are the safety fallback when location or routing data
    // is incomplete. Keep them visible to dispatchers so a person can triage.
    query = auth.organisationId
      ? query.or(`routed_organisation_id.eq.${auth.organisationId},routed_organisation_id.is.null`)
      : query.is('routed_organisation_id', null);
  } else if (auth.role === 'requester' || options.scope === 'mine') {
    query = query.eq('requester_id', auth.userId);
  } else {
    if (!auth.organisationId) {
      return { items: [], total: 0 };
    }
    query = query.or(
      `routed_organisation_id.eq.${auth.organisationId},routed_organisation_id.is.null`,
    );
  }

  if (options.scope === 'new') {
    query = query.in('current_status', ['submitted', 'received']);
  } else if (options.scope === 'active') {
    query = query.in('current_status', OPEN_STATUSES);
  } else if (options.scope === 'completed') {
    query = query.in('current_status', ['closed', 'cancelled', 'rejected']);
  }

  if (options.status) {
    const requestedStatuses = options.status
      .split(',')
      .map((status) => status.trim().toLowerCase())
      // "completed" is an assignment status; completed emergency requests
      // are stored as "closed" in the emergency_status enum.
      .map((status) => status === 'completed' ? 'closed' : status);
    query = query.in('current_status', [...new Set(requestedStatuses)]);
  }
  if (options.search) {
    query = query.ilike('reference_code', `%${options.search}%`);
  }
  if (options.dateFrom) {
    query = query.gte('submitted_at', options.dateFrom);
  }
  if (options.dateTo) {
    query = query.lt('submitted_at', options.dateTo);
  }

  const { data, error, count } = await query;
  if (error) throw ApiError.internal('Could not load requests.', error.message);

  return { items: (data ?? []).map(mapSummary), total: count ?? 0 };
}

export async function listCancellationRequests(
  auth: AuthPrincipal,
): Promise<EmergencyRequestSummary[]> {
  assertCanAct(auth, ['dispatcher', 'admin']);

  let query = db()
    .from('emergency_requests')
    .select(REQUEST_COLUMNS)
    .not('cancellation_requested_at', 'is', null)
    .in('current_status', OPEN_STATUSES)
    .order('cancellation_requested_at', { ascending: true })
    .limit(100);

  if (auth.role === 'dispatcher') {
    if (!auth.organisationId) return [];
    query = query.eq('routed_organisation_id', auth.organisationId);
  }

  const { data, error } = await query;
  if (error) throw ApiError.internal('Could not load cancellation requests.', error.message);
  return (data ?? []).map(mapSummary);
}

export async function getRequestSummary(id: string): Promise<EmergencyRequestSummary> {
  const { data, error } = await db()
    .from('emergency_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw ApiError.internal('Could not load that request.', error.message);
  if (!data) throw ApiError.notFound();
  return mapSummary(data);
}

export async function getRequestDetail(
  id: string,
  auth: AuthPrincipal,
): Promise<EmergencyRequestDetail> {
  const { data, error } = await db()
    .from('emergency_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw ApiError.internal('Could not load that request.', error.message);
  if (!data) throw ApiError.notFound();

  const summary = mapSummary(data);
  assertCanView(summary, auth);
  const requesterTrackingEnded = auth.role === 'requester' &&
    ['completed', 'closed', 'cancelled', 'rejected'].includes(String(summary.currentStatus).toLowerCase());
  const responderProjection = requesterTrackingEnded
    ? 'responder:responder_profiles ( organisation_id, employee_number, user:users ( id, first_name, last_name, display_name ) )'
    : 'responder:responder_profiles ( organisation_id, employee_number, current_latitude, current_longitude, user:users ( id, first_name, last_name, display_name ) )';

  let assignmentsQuery = db()
    .from('request_assignments')
    .select(
      'id, organisation_id, responder_user_id, team_id, vehicle_id, status, eta_minutes, ' +
        'assignment_note, assigned_at, acknowledged_at, route_started_at, arrived_at, completed_at, assigned_by_user_id, ' +
        'assigned_by:users!request_assignments_assigned_by_user_id_fkey ( id, first_name, last_name, display_name ), ' +
        responderProjection + ', ' +
        'team:responder_teams ( id, name ), vehicle:vehicles ( id, call_sign, registration_number )',
    )
    .eq('request_id', id)
    .order('assigned_at', { ascending: true });
  if (auth.role === 'dispatcher' && auth.organisationId) {
    assignmentsQuery = assignmentsQuery.eq('organisation_id', auth.organisationId);
  }

  const [history, assignments, notes] = await Promise.all([
    db()
      .from('request_status_history')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true }),
    assignmentsQuery,
    db()
      .from('operational_notes')
      .select(
        'id, author_user_id, note, requester_visible, created_at, ' +
          'author:users ( id, first_name, last_name, display_name )',
      )
      .eq('request_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
  ]);

  const includeRequesterProfileDetails = ['dispatcher', 'admin', 'responder'].includes(auth.role);
  const [medicalDetails, emergencyContact] = includeRequesterProfileDetails
    ? await Promise.all([
        db()
          .from('requester_medical_details')
          .select('conditions, allergies, medications')
          .eq('user_id', summary.requesterId)
          .maybeSingle(),
        db()
          .from('emergency_contacts')
          .select('full_name, phone, is_primary')
          .eq('user_id', summary.requesterId)
          .order('is_primary', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    : [{ data: null, error: null }, { data: null, error: null }];

  if (medicalDetails.error) throw ApiError.internal('Could not load requester medical details.', medicalDetails.error.message);
  if (emergencyContact.error) throw ApiError.internal('Could not load requester emergency contact.', emergencyContact.error.message);

  // A requester sees only the notes staff explicitly marked visible to them.
  const noteRows = (notes.data ?? []) as unknown as Array<{ requester_visible: boolean }>;
  const visibleNotes = noteRows.filter(
    (row) => auth.role !== 'requester' || row.requester_visible,
  );

  const row = data as Record<string, unknown>;
  const assignmentRows = (assignments.data ?? []) as unknown as Row[];

  return {
    ...summary,
    note: (row.note as string | null) ?? null,
    receivedAt: (row.received_at as string | null) ?? null,
    assignedAt: (row.assigned_at as string | null) ?? null,
    enRouteAt: (row.en_route_at as string | null) ?? null,
    arrivedAt: (row.arrived_at as string | null) ?? null,
    cancellationRequestedAt: (row.cancellation_requested_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancellationReason: (row.cancellation_reason as string | null) ?? null,
    rejectedAt: (row.rejected_at as string | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    history: (history.data ?? []).map(mapHistory),
    ...(includeRequesterProfileDetails ? {
      requesterMedicalDetails: medicalDetails.data ? {
        conditions: medicalDetails.data.conditions ?? '',
        allergies: medicalDetails.data.allergies ?? '',
        medications: medicalDetails.data.medications ?? '',
      } : null,
      requesterEmergencyContact: emergencyContact.data ? {
        name: emergencyContact.data.full_name ?? '',
        phone: emergencyContact.data.phone ?? '',
      } : null,
    } : {}),
    assignments: assignmentRows
      .filter((assignment) =>
        auth.role !== 'dispatcher' ||
        !assignment.responder_user_id ||
        assignment.responder?.organisation_id === auth.organisationId,
      )
      .map(mapAssignment),
    operationalNotes: visibleNotes.map(mapNote),
  };
}

/* -------------------------------------------------------------------------- */
/* Create (Block 5, Person 7 and 8)                                            */
/* -------------------------------------------------------------------------- */

export interface CreateRequestResult {
  request: EmergencyRequestDetail;
  /** How the request was routed. Returned rather than stored on the module so
   *  concurrent submissions cannot read each other's outcome. */
  routing: RoutingDecision;
}

type AvailableResponder = {
  user_id: string;
  current_latitude: number | null;
  current_longitude: number | null;
};

type AutomaticAssignmentResult =
  | { assigned: true; responderUserId: string; etaMinutes: number }
  | { assigned: false; reason: "no_route" | "no_available_responder" | "claim_failed" | "assignment_failed" };

function distanceMetresBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function maxAutomaticDispatchDistanceMetres(): number {
  const configuredKm = Number(process.env.ROUTING_MAX_RADIUS_KM);
  return Math.min(Number.isFinite(configuredKm) && configuredKm > 0 ? configuredKm : 40, 40) * 1000;
}

/**
 * Claims the nearest online responder in the routed organisation. The
 * availability update is conditional, so two submissions cannot both take a
 * responder who has just been claimed by the other request. A failed lookup or
 * claim is deliberately non-fatal: the request remains visible to dispatch.
 */
export async function automaticallyAssignNearestResponder(input: {
  requestId: string;
  organisationId: string | null;
  latitude: number;
  longitude: number;
  responderUserId?: string;
}): Promise<AutomaticAssignmentResult> {
  if (!input.organisationId) return { assigned: false, reason: "no_route" };

  const { data: requestOwner, error: requestOwnerError } = await db()
    .from("emergency_requests")
    .select("requester_id, category, routed_organisation_id")
    .eq("id", input.requestId)
    .maybeSingle();

  if (requestOwnerError || !requestOwner) {
    console.error('automatic_assignment_request_lookup_failed', {
      requestId: input.requestId,
      message: requestOwnerError?.message ?? 'Request not found.',
    });
    return { assigned: false, reason: "assignment_failed" };
  }

  if (requestOwner.routed_organisation_id && requestOwner.routed_organisation_id !== input.organisationId) {
    return { assigned: false, reason: "no_route" };
  }

  const { data: targetOrganisation, error: targetOrganisationError } = await db()
    .from("organisations")
    .select("organisation_type")
    .eq("id", input.organisationId)
    .maybeSingle();
  if (targetOrganisationError || !targetOrganisation) {
    console.error('automatic_assignment_organisation_lookup_failed', {
      requestId: input.requestId,
      organisationId: input.organisationId,
      message: targetOrganisationError?.message ?? 'Organisation not found.',
    });
    return { assigned: false, reason: "assignment_failed" };
  }

  if (!organisationTypesForEmergencyCategory(requestOwner.category).includes(targetOrganisation.organisation_type)) {
    return { assigned: false, reason: "no_route" };
  }

  // Do not draw a second assignment for a request that has already been
  // claimed by another responder. The database constraint below is the final
  // race-safe guard; this read avoids unnecessary work in the normal path.
  const { data: existingAssignment, error: existingAssignmentError } = await db()
    .from("request_assignments")
    .select("id")
    .eq("request_id", input.requestId)
    .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
    .limit(1)
    .maybeSingle();

  if (existingAssignmentError) {
    console.error('automatic_assignment_existing_request_check_failed', {
      requestId: input.requestId,
      code: existingAssignmentError.code,
      message: existingAssignmentError.message,
    });
    return { assigned: false, reason: "assignment_failed" };
  }
  if (existingAssignment) {
    return { assigned: false, reason: existingAssignment ? "claim_failed" : "assignment_failed" };
  }

  let respondersQuery = db()
    .from("responder_profiles")
    .select("user_id, current_latitude, current_longitude")
    .eq("organisation_id", input.organisationId)
    .eq("availability", "available");

  if (input.responderUserId) {
    respondersQuery = respondersQuery.eq("user_id", input.responderUserId);
  } else {
    // Nearest-responder dispatch requires a known responder position.
    respondersQuery = respondersQuery
      .not("current_latitude", "is", null)
      .not("current_longitude", "is", null);
  }

  const { data: responders, error: responderError } = await respondersQuery;

  if (responderError) {
    console.error('automatic_assignment_responder_lookup_failed', {
      requestId: input.requestId,
      organisationId: input.organisationId,
      responderUserId: input.responderUserId ?? null,
      code: responderError.code,
      message: responderError.message,
    });
    return { assigned: false, reason: "assignment_failed" };
  }
  if (!responders?.length) {
    return { assigned: false, reason: "no_available_responder" };
  }

  const { data: activeAssignments, error: activeAssignmentsError } = await db()
    .from("request_assignments")
    .select("responder_user_id, request_id")
    .not("responder_user_id", "is", null)
    .in("status", ["assigned", "acknowledged", "en_route", "arrived"]);

  if (activeAssignmentsError) {
    console.error('automatic_assignment_active_assignments_lookup_failed', {
      requestId: input.requestId,
      code: activeAssignmentsError.code,
      message: activeAssignmentsError.message,
    });
    return { assigned: false, reason: "assignment_failed" };
  }
  const activeRequestIds = [...new Set((activeAssignments ?? []).map((assignment) => assignment.request_id))];
  const { data: activeRequests, error: activeRequestsError } = activeRequestIds.length
    ? await db().from("emergency_requests").select("id, current_status").in("id", activeRequestIds)
    : { data: [], error: null };
  if (activeRequestsError) {
    console.error('automatic_assignment_active_requests_lookup_failed', {
      requestId: input.requestId,
      code: activeRequestsError.code,
      message: activeRequestsError.message,
    });
    return { assigned: false, reason: "assignment_failed" };
  }
  const openRequestIds = new Set(
    (activeRequests ?? [])
      .filter((request) => ["submitted", "received", "assigned", "en_route", "arrived"].includes(String(request.current_status).toLowerCase()))
      .map((request) => request.id),
  );
  const busyResponderIds = new Set(
    (activeAssignments ?? [])
      .filter((assignment) => openRequestIds.has(assignment.request_id))
      .map((assignment) => assignment.responder_user_id)
      .filter(Boolean),
  );

  const ordered = (responders as AvailableResponder[])
    .filter((responder) => !busyResponderIds.has(responder.user_id))
    .filter((responder) => responder.current_latitude !== null && responder.current_longitude !== null)
    .filter((responder) => distanceMetresBetween(
      { latitude: Number(responder.current_latitude), longitude: Number(responder.current_longitude) },
      { latitude: input.latitude, longitude: input.longitude },
    ) <= maxAutomaticDispatchDistanceMetres())
    .sort((left, right) => {
      const leftDistance = distanceMetresBetween(
        { latitude: Number(left.current_latitude), longitude: Number(left.current_longitude) },
        { latitude: input.latitude, longitude: input.longitude },
      );
      const rightDistance = distanceMetresBetween(
        { latitude: Number(right.current_latitude), longitude: Number(right.current_longitude) },
        { latitude: input.latitude, longitude: input.longitude },
      );
      return leftDistance - rightDistance;
    });

  for (const responder of ordered) {
    const hasResponderLocation =
      responder.current_latitude !== null && responder.current_longitude !== null;
    const distanceMetres = hasResponderLocation
      ? distanceMetresBetween(
          { latitude: Number(responder.current_latitude), longitude: Number(responder.current_longitude) },
          { latitude: input.latitude, longitude: input.longitude },
        )
      : 0;
    // A conservative 40 km/h estimate, with a practical three-minute floor.
    const etaMinutes = Math.max(3, Math.min(45, Math.ceil((distanceMetres / 1000 / 40) * 60)));
    const now = new Date().toISOString();

    const { data: claimed, error: claimError } = await db()
      .from("responder_profiles")
      .update({ availability: "assigned", updated_at: now })
      .eq("user_id", responder.user_id)
      .eq("availability", "available")
      .select("user_id")
      .maybeSingle();

    if (claimError) {
      console.error('automatic_assignment_responder_claim_failed', {
        requestId: input.requestId,
        responderUserId: responder.user_id,
        code: claimError.code,
        message: claimError.message,
      });
      continue;
    }
    if (!claimed) continue;

    const { data: assignment, error: assignmentError } = await db()
      .from("request_assignments")
      .insert({
        request_id: input.requestId,
        organisation_id: input.organisationId,
        responder_user_id: responder.user_id,
        assigned_by_user_id: null, // System assignment; manual assignments store the dispatcher user id.
        status: "assigned",
        eta_minutes: etaMinutes,
        assignment_note: "Assigned automatically to the nearest available responder.",
      })
      .select("id")
      .single();

    if (assignmentError) {
      console.error('automatic_assignment_insert_failed', {
        requestId: input.requestId,
        responderUserId: responder.user_id,
        organisationId: input.organisationId,
        code: assignmentError.code,
        message: assignmentError.message,
        details: assignmentError.details,
        hint: assignmentError.hint,
      });
      await db().from("responder_profiles").update({ availability: "available", updated_at: now }).eq("user_id", responder.user_id);
      return { assigned: false, reason: "assignment_failed" };
    }

    const { error: requestError } = await db()
      .from("emergency_requests")
      .update({
        current_status: "assigned",
        is_active: true,
        is_cancelled: false,
        received_at: now,
        assigned_at: now,
        eta_minutes: etaMinutes,
        estimated_arrival_at: new Date(Date.now() + etaMinutes * 60_000).toISOString(),
      })
      .eq("id", input.requestId);

    if (requestError) {
      console.error('automatic_assignment_request_update_failed', {
        requestId: input.requestId,
        responderUserId: responder.user_id,
        code: requestError.code,
        message: requestError.message,
        details: requestError.details,
        hint: requestError.hint,
      });
      // Do not leave an invisible assignment behind if the request status
      // cannot be advanced. The request can then safely fall back to dispatch.
      if (assignment?.id) {
        await db().from("request_assignments").delete().eq("id", assignment.id);
      }
      await db().from("responder_profiles").update({ availability: "available", updated_at: now }).eq("user_id", responder.user_id);
      return { assigned: false, reason: "assignment_failed" };
    }

    await Promise.all([
      appendHistory(input.requestId, {
        previousStatus: "submitted",
        newStatus: "received",
        userId: null,
        role: null,
        reason: "Automatic dispatch started",
        note: "A nearby responder is being selected.",
      }),
      appendHistory(input.requestId, {
        previousStatus: "received",
        newStatus: "assigned",
        userId: null,
        role: null,
        reason: "Responder assigned automatically",
        note: `Nearest available responder assigned. Estimated arrival: ${etaMinutes} minutes.`,
      }),
      db().from("notifications").insert({
        recipient_user_id: responder.user_id,
        request_id: input.requestId,
        notification_type: "assignment",
        title: "New mission assigned",
        message: "You have been selected for a nearby emergency request.",
        sensitivity: "normal",
      }),
      requestOwner?.requester_id
        ? db().from("notifications").insert({
            recipient_user_id: requestOwner.requester_id,
            request_id: input.requestId,
            notification_type: "driver_found",
            title: "Responder assigned",
            message: `A responder has been assigned. Estimated arrival: ${etaMinutes} minutes.`,
            sensitivity: "normal",
          })
        : Promise.resolve(),
    ]);

    return { assigned: true, responderUserId: responder.user_id, etaMinutes };
  }

  return { assigned: false, reason: "claim_failed" };
}

/**
 * Mark assignments against terminal requests as terminal before the responder
 * is considered for new work. Direct SQL imports and interrupted updates can
 * otherwise leave an active assignment row behind and trip the one-active-
 * assignment constraint even though the request itself is already closed.
 */
export async function reconcileResponderTerminalAssignments(responderUserId: string): Promise<void> {
  const { data: assignments, error: assignmentsError } = await db()
    .from('request_assignments')
    .select('id, request_id, status')
    .eq('responder_user_id', responderUserId)
    .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived']);

  if (assignmentsError) {
    throw ApiError.internal('Could not check responder assignments.', assignmentsError.message);
  }
  if (assignments?.length) {
    const requestIds = [...new Set(assignments.map((assignment) => assignment.request_id))];
    const { data: requests, error: requestsError } = await db()
      .from('emergency_requests')
      .select('id, current_status, closed_at, cancelled_at, rejected_at')
      .in('id', requestIds);

    if (requestsError) {
      throw ApiError.internal('Could not verify responder request status.', requestsError.message);
    }

    const requestById = new Map((requests ?? []).map((request) => [request.id, request]));
    for (const assignment of assignments) {
      const request = requestById.get(assignment.request_id);
      const now = new Date().toISOString();
      const status = request ? String(request.current_status).toLowerCase() : 'missing';
      const update: {
        status: 'completed' | 'cancelled' | 'rejected';
        completed_at?: string;
        cancelled_at?: string;
        rejected_at?: string;
        rejection_reason?: string;
        updated_at: string;
      } | null = status === 'closed'
        ? { status: 'completed', completed_at: request?.closed_at ?? now, updated_at: now }
        : status === 'cancelled'
          ? { status: 'cancelled', cancelled_at: request?.cancelled_at ?? now, updated_at: now }
          : status === 'rejected'
            ? { status: 'rejected', rejected_at: request?.rejected_at ?? now, updated_at: now }
            : status === 'missing'
              ? {
                  status: 'cancelled',
                  cancelled_at: now,
                  rejection_reason: 'The assigned emergency request no longer exists.',
                  updated_at: now,
                }
              : null;

      if (!update) continue;

      const { error: updateError } = await db()
        .from('request_assignments')
        .update(update)
        .eq('id', assignment.id)
        .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived']);

      if (updateError) {
        throw ApiError.internal('Could not release a stale responder assignment.', updateError.message);
      }
    }
  }

  const { data: remainingAssignments, error: remainingAssignmentsError } = await db()
    .from('request_assignments')
    .select('id')
    .eq('responder_user_id', responderUserId)
    .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived'])
    .limit(1);

  if (remainingAssignmentsError) {
    throw ApiError.internal('Could not confirm whether the responder still has an active assignment.', remainingAssignmentsError.message);
  }
  if (remainingAssignments?.length) return;

  // A cancelled/closed request can leave its responder profile marked busy,
  // especially when the request was updated outside the normal API flow.
  // Keep an explicit offline choice, but release stale mission states.
  const { data: profile, error: profileError } = await db()
    .from('responder_profiles')
    .select('availability, go_offline_after_mission')
    .eq('user_id', responderUserId)
    .maybeSingle();

  if (profileError) {
    throw ApiError.internal('Could not load responder availability after assignment cleanup.', profileError.message);
  }
  if (profile?.go_offline_after_mission) {
    const { error: availabilityError } = await db()
      .from('responder_profiles')
      .update({ availability: 'offline', go_offline_after_mission: false, updated_at: new Date().toISOString() })
      .eq('user_id', responderUserId)
      .eq('go_offline_after_mission', true);

    if (availabilityError) {
      throw ApiError.internal('Could not apply the responder offline-after-mission choice.', availabilityError.message);
    }
  } else if (profile && ['assigned', 'en_route', 'on_scene'].includes(String(profile.availability))) {
    const { error: availabilityError } = await db()
      .from('responder_profiles')
      .update({ availability: 'available', updated_at: new Date().toISOString() })
      .eq('user_id', responderUserId)
      .in('availability', ['assigned', 'en_route', 'on_scene']);

    if (availabilityError) {
      throw ApiError.internal('Could not release the responder after assignment cleanup.', availabilityError.message);
    }
  }
}

/**
 * Gives an available responder the oldest request waiting for that
 * organisation. Requests are intentionally kept in `submitted` status until
 * this succeeds, so a temporary lack of responders never rejects the request.
 */
export async function assignNextQueuedRequest(
  responderUserId: string,
  organisationId: string,
): Promise<AutomaticAssignmentResult> {
  const { data: queued, error } = await db()
    .from("emergency_requests")
    .select("id")
    .or(`routed_organisation_id.eq.${organisationId},routed_organisation_id.is.null`)
    .in("current_status", ["submitted", "received"])
    .is("cancellation_requested_at", null)
    .order("submitted_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error('automatic_assignment_queue_lookup_failed', {
      responderUserId,
      organisationId,
      code: error.code,
      message: error.message,
    });
    return { assigned: false, reason: "assignment_failed" };
  }
  if (!queued?.length) {
    return { assigned: false, reason: "no_available_responder" };
  }

  for (const row of queued as Array<{ id: string }>) {
    const { data: location, error: locationError } = await db()
      .from("request_locations")
      .select("latitude, longitude")
      .eq("request_id", row.id)
      .maybeSingle();

    if (locationError) {
      console.error('automatic_assignment_location_lookup_failed', {
        requestId: row.id,
        responderUserId,
        organisationId,
        code: locationError.code,
        message: locationError.message,
      });
      return { assigned: false, reason: "assignment_failed" };
    }

    if (!location) continue;

    const result = await automaticallyAssignNearestResponder({
      requestId: row.id,
      organisationId,
      responderUserId,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    });

    if (result.assigned) return result;
  }

  return { assigned: false, reason: "claim_failed" };
}

export async function createRequest(
  auth: AuthPrincipal,
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  // Duplicate prevention. idempotency_key is `not null unique` in the schema,
  // so a retry of the same submission hits the unique index rather than
  // creating a second emergency.
  const existing = await db()
    .from('emergency_requests')
    .select('id, requester_id, routed_organisation_id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as { id: string; requester_id: string; routed_organisation_id: string | null };
    if (row.requester_id !== auth.userId) throw ApiError.notFound();
    // The request row is inserted before its location upsert. If that upsert
    // failed, a retry with the same idempotency key must still persist the
    // submitted coordinates instead of returning an incomplete request.
    await saveLocation(row.id, input);
    return {
      request: await getRequestDetail(row.id, auth),
      routing: {
        organisationId: row.routed_organisation_id,
        organisationName: null,
        distanceMetres: null,
        reason: 'routed',
        candidateCount: 0,
      },
    };
  }

  // A requester may have only one open emergency at a time. This check is
  // intentionally server-side so a second browser tab cannot bypass the UI.
  const activeRequest = await db()
    .from('emergency_requests')
    .select('id')
    .eq('requester_id', auth.userId)
    .in('current_status', OPEN_STATUSES)
    .limit(1)
    .maybeSingle();

  if (activeRequest.error) {
    throw ApiError.internal('Could not verify your active emergency request.', activeRequest.error.message);
  }

  if (activeRequest.data) {
    throw new ApiError(
      'DUPLICATE_REQUEST',
      'You already have an active emergency request. Open it before requesting additional help.',
      { details: { requestId: activeRequest.data.id } },
    );
  }

  const now = new Date().toISOString();
  let reference = generateReference();

  // The reference is random; retry on the astronomically unlikely clash.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await db()
      .from('emergency_requests')
      .insert({
        reference_code: reference,
        requester_id: auth.userId,
        category: input.category,
        severity: input.severity,
        note: input.note ?? null,
        callback_number: input.callbackNumber,
        current_status: 'submitted',
        is_active: true,
        is_cancelled: false,
        source: 'responsive_web',
        idempotency_key: input.idempotencyKey,
        client_request_id: input.clientRequestId ?? null,
        submitted_at: now,
      })
      .select('id')
      .single();

    if (!error) {
      const requestId = (data as { id: string }).id;

      // Location first - routing needs it.
      await saveLocation(requestId, input);

      // Route to the nearest responding organisation. This never throws and
      // never blocks the submission: an unroutable request is still created,
      // with routed_organisation_id null, and stays visible to every
      // dispatcher so a human can triage it.
      let routing = await chooseOrganisation({
        latitude: input.latitude,
        longitude: input.longitude,
        category: input.category,
      });

      if (routing.organisationId) {
        const routed = await db()
          .from('emergency_requests')
          .update({ routed_organisation_id: routing.organisationId })
          .eq('id', requestId);

        if (routed.error) {
          // Losing the routing is survivable; losing the request is not.
          routing = { ...routing, organisationId: null, reason: 'lookup_failed' };
        }
      }

      const km =
        routing.distanceMetres === null
          ? null
          : Math.round(routing.distanceMetres / 100) / 10;

      await appendHistory(requestId, {
        previousStatus: null,
        newStatus: 'submitted',
        userId: auth.userId,
        role: auth.role,
        reason: 'Request submitted',
        note: routing.organisationName
          ? `Routed to ${routing.organisationName}, ${km} km away`
          : `Not automatically routed (${routing.reason}). Dispatch review required.`,
      });

      const { error: submittedNotificationError } = await db().from("notifications").insert({
        recipient_user_id: auth.userId,
        request_id: requestId,
        notification_type: "request_submitted",
        title: "Request submitted",
        message: "Your emergency request has been submitted.",
        sensitivity: "normal",
      });
      if (submittedNotificationError) console.error("Request notification error:", submittedNotificationError.message);

      // Dispatch is the exception path, not the normal assignment path. A
      // request is automatically assigned only to an online responder in the
      // routed organisation; when none can be safely claimed it stays on the
      // dispatcher queue for human triage.
      if (input.latitude !== undefined && input.longitude !== undefined) {
        try {
          const assignment = await automaticallyAssignNearestResponder({
            requestId,
            organisationId: routing.organisationId,
            latitude: input.latitude,
            longitude: input.longitude,
          });
          if (!assignment.assigned) {
            console.warn('request_auto_assignment_not_completed', {
              requestId,
              organisationId: routing.organisationId,
              reason: assignment.reason,
            });
          }
        } catch (error) {
          // Assignment automation must never prevent a received emergency
          // request from reaching the dispatcher fallback queue.
          console.error('request_auto_assignment_failed', {
            requestId,
            organisationId: routing.organisationId,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { request: await getRequestDetail(requestId, auth), routing };
    }

    if (isUniqueViolation(error) && error.message.includes('idempotency')) {
      throw new ApiError('DUPLICATE_REQUEST', 'This request has already been submitted.');
    }
    if (isUniqueViolation(error) && error.message.includes('one_active_per_requester')) {
      throw new ApiError(
        'DUPLICATE_REQUEST',
        'You already have an active emergency request. Open it before requesting additional help.',
      );
    }
    if (isUniqueViolation(error)) {
      reference = generateReference();
      continue;
    }
    throw ApiError.internal('Could not submit that request.', error.message);
  }

  throw ApiError.internal('Could not allocate a request reference.');
}

/* -------------------------------------------------------------------------- */
/* Location (Block 4)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * request_locations is 1:1 with a unique request_id, so this is an UPSERT of
 * the current location rather than an append to a ping stream. See
 * supabase/migrations/0001_request_location_pings.sql if the team decides to
 * add continuous tracking history.
 */
export async function saveLocation(
  requestId: string,
  input: LocationUpdateInput | CreateRequestInput,
): Promise<void> {
  const isManual = input.locationMethod === 'manual';

  // A manual entry with no coordinates still has to satisfy the not-null
  // lat/lon columns; 0,0 is used as the explicit "unknown" sentinel and
  // address_text carries the real information.
  const { error } = await db()
    .from('request_locations')
    .upsert(
      {
        request_id: requestId,
        latitude: input.latitude ?? 0,
        longitude: input.longitude ?? 0,
        accuracy_meters: input.accuracyMeters ?? null,
        address_text: input.addressText ?? null,
        landmark: input.landmark ?? null,
        location_method: input.locationMethod,
        captured_at: input.capturedAt ?? new Date().toISOString(),
        confirmed_at: isManual ? new Date().toISOString() : null,
      },
      { onConflict: 'request_id' },
    );

  if (error) throw ApiError.internal('Could not save that location.', error.message);
}

/* -------------------------------------------------------------------------- */
/* Status changes (Block 6)                                                    */
/* -------------------------------------------------------------------------- */

async function appendHistory(
  requestId: string,
  entry: {
    previousStatus: RequestStatus | null;
    newStatus: RequestStatus;
    userId: string | null;
    role: UserRole | null;
    reason?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { error } = await db().from('request_status_history').insert({
    request_id: requestId,
    previous_status: entry.previousStatus,
    new_status: entry.newStatus,
    changed_by_user_id: entry.userId,
    actor_role: entry.role,
    changed_by_system: entry.userId === null,
    reason: entry.reason ?? null,
    note: entry.note ?? null,
  });

  if (error) {
    throw ApiError.internal('Could not record the status change.', error.message);
  }
}

export async function changeStatus(
  requestId: string,
  auth: AuthPrincipal,
  input: StatusChangeInput,
): Promise<EmergencyRequestDetail> {
  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  const target = input.status as RequestStatus;

  // Requester cancellation has assignment-aware rules and must use the same
  // service as the dedicated cancellation endpoint.
  if (input.expectedStatus && input.expectedStatus !== current.currentStatus) {
    throw new ApiError(
      'CONFLICT',
      `Someone already moved this request to ${current.currentStatus}. Reload and try again.`,
    );
  }
  if (auth.role === 'requester' && target === 'cancelled') {
    return requestCancellation(requestId, auth, input.reason);
  }
  if (target === 'assigned' && current.cancellationRequestedAt) {
    throw new ApiError('CONFLICT', 'This request has a pending cancellation decision.');
  }

  const { data: existingAssignment, error: existingAssignmentError } = await db()
    .from('request_assignments')
    .select('id')
    .eq('request_id', requestId)
    .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived'])
    .limit(1)
    .maybeSingle();

  if (existingAssignmentError) {
    throw ApiError.internal('Could not verify whether this request is already assigned.', existingAssignmentError.message);
  }

  if (
    existingAssignment &&
    !(target === 'assigned' && (auth.role === 'dispatcher' || auth.role === 'admin'))
  ) {
    throw new ApiError('CONFLICT', 'This emergency is already assigned to a responder.');
  }

  const verdict = canTransition(current.currentStatus, target, auth.role);
  if (!verdict.allowed) {
    throw new ApiError('STATUS_TRANSITION_INVALID', verdict.reason ?? 'That change is not allowed.');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { current_status: target, updated_at: now };

  const stampColumn = STATUS_TIMESTAMP_COLUMN[target];
  if (stampColumn) patch[stampColumn] = now;

  if (target === 'closed' || target === 'cancelled' || target === 'rejected') {
    patch.is_active = false;
  }
  if (target === 'cancelled') {
    patch.is_cancelled = true;
    patch.cancellation_reason = input.reason ?? null;
  }
  if (target === 'rejected') {
    patch.rejection_reason = input.reason ?? null;
  }
  if (input.etaMinutes !== undefined) {
    patch.eta_minutes = input.etaMinutes;
    patch.estimated_arrival_at = new Date(Date.now() + input.etaMinutes * 60_000).toISOString();
  }

  const { data: updated, error } = await db()
    .from('emergency_requests')
    .update(patch)
    .eq('id', requestId)
    // Guard against a concurrent writer that changed the row since the read.
    .eq('current_status', current.currentStatus)
    .select('id')
    .maybeSingle();

  if (error) throw ApiError.internal('Could not update that request.', error.message);
  if (!updated) throw new ApiError('CONFLICT', 'The request changed before this update could be saved. Reload and try again.');

  await appendHistory(requestId, {
    previousStatus: current.currentStatus,
    newStatus: target,
    userId: auth.userId,
    role: auth.role,
    reason: input.reason ?? null,
    note: input.note ?? null,
  });

  return getRequestDetail(requestId, auth);
}

/** Cancel immediately when no active assignment exists; otherwise queue for dispatch approval. */
export async function requestCancellation(
  requestId: string,
  auth: AuthPrincipal,
  reason?: string,
): Promise<EmergencyRequestDetail> {
  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  if (current.requesterId !== auth.userId) throw ApiError.forbidden();

  if (!OPEN_STATUSES.includes(current.currentStatus)) {
    throw new ApiError('CONFLICT', 'This request is no longer active and cannot be cancelled.');
  }

  const activeAssignmentStatuses = ['assigned', 'acknowledged', 'en_route', 'arrived'];
  const { data: activeAssignment, error: assignmentError } = await db()
    .from('request_assignments')
    .select('id, organisation_id')
    .eq('request_id', requestId)
    .in('status', activeAssignmentStatuses)
    .limit(1)
    .maybeSingle();

  if (assignmentError) {
    throw ApiError.internal('Could not verify whether a responder is assigned.', assignmentError.message);
  }

  if (activeAssignment && current.cancellationRequestedAt) {
    await notifyOrganisationDispatchers({
      organisationId: activeAssignment.organisation_id ?? current.organisationId,
      requestId,
      notificationType: 'cancellation_requested',
      title: 'Cancellation requested',
      message: `The requester asked to cancel ${current.reference}. Approval is needed because a responder is assigned.`,
      sensitivity: 'urgent',
    });
    return getRequestDetail(requestId, auth);
  }

  const now = new Date().toISOString();
  if (activeAssignment) {
    const { data: updated, error } = await db()
      .from('emergency_requests')
      .update({
        cancellation_requested_at: now,
        cancellation_reason: reason ?? current.cancellationReason ?? null,
        updated_at: now,
      })
      .eq('id', requestId)
      .eq('current_status', current.currentStatus)
      .is('cancelled_at', null)
      .select('id')
      .maybeSingle();

    if (error) throw ApiError.internal('Could not record that request.', error.message);
    if (!updated) throw new ApiError('CONFLICT', 'The request changed while cancellation was being submitted. Refresh and try again.');
    await notifyOrganisationDispatchers({
      organisationId: activeAssignment.organisation_id ?? current.organisationId,
      requestId,
      notificationType: 'cancellation_requested',
      title: 'Cancellation requested',
      message: `The requester asked to cancel ${current.reference}. Approval is needed because a responder is assigned.`,
      sensitivity: 'urgent',
    });
    return getRequestDetail(requestId, auth);
  }

  const { data: updated, error } = await db()
    .from('emergency_requests')
    .update({
      current_status: 'cancelled',
      is_active: false,
      is_cancelled: true,
      cancellation_requested_at: null,
      cancelled_at: now,
      cancellation_reason: reason ?? null,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('current_status', current.currentStatus)
    .is('cancelled_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw ApiError.internal('Could not record that request.', error.message);
  if (!updated) throw new ApiError('CONFLICT', 'The request changed while cancellation was being submitted. Refresh and try again.');

  await appendHistory(requestId, {
    previousStatus: current.currentStatus,
    newStatus: 'cancelled',
    userId: auth.userId,
    role: auth.role,
    reason: reason ?? null,
    note: 'Cancelled immediately because no active responder assignment existed.',
  });

  try {
    await notifyRequestCancellationCompleted({
      recipientUserId: current.requesterId,
      requestId,
      reference: current.reference,
    });
  } catch (notificationError) {
    console.warn('requester_cancellation_completion_notification_failed', notificationError);
  }
  if (current.organisationId) {
    try {
      await notifyOrganisationDispatchers({
        organisationId: current.organisationId,
        requestId,
        notificationType: 'request_cancelled',
        title: 'Request cancelled',
        message: `Request ${current.reference} was successfully cancelled.`,
        sensitivity: 'normal',
      });
    } catch (notificationError) {
      console.warn('dispatcher_cancellation_completion_notification_failed', notificationError);
    }
  }

  return getRequestDetail(requestId, auth);
}

export async function approveRequestCancellation(
  requestId: string,
  auth: AuthPrincipal,
): Promise<EmergencyRequestDetail> {
  assertCanAct(auth, ['dispatcher', 'admin']);
  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  if (!current.cancellationRequestedAt) {
    throw new ApiError('CONFLICT', 'This request has no pending cancellation request.');
  }
  if (!OPEN_STATUSES.includes(current.currentStatus)) {
    throw new ApiError('CONFLICT', 'This request is no longer active.');
  }

  const activeAssignmentStatuses = ['assigned', 'acknowledged', 'en_route', 'arrived'];
  const { data: assignments, error: assignmentError } = await db()
    .from('request_assignments')
    .select('id, organisation_id, responder_user_id, team_id, vehicle_id')
    .eq('request_id', requestId)
    .in('status', activeAssignmentStatuses);

  if (assignmentError) {
    throw ApiError.internal('Could not load the assigned response resources.', assignmentError.message);
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await db()
    .from('emergency_requests')
    .update({
      current_status: 'cancelled',
      is_active: false,
      is_cancelled: true,
      cancellation_requested_at: null,
      cancelled_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('current_status', current.currentStatus)
    .not('cancellation_requested_at', 'is', null)
    .select('id')
    .maybeSingle();

  if (error) throw ApiError.internal('Could not approve this cancellation.', error.message);
  if (!updated) throw new ApiError('CONFLICT', 'The request changed before this cancellation could be approved. Refresh and try again.');

  await appendHistory(requestId, {
    previousStatus: current.currentStatus,
    newStatus: 'cancelled',
    userId: auth.userId,
    role: auth.role,
    reason: current.cancellationReason ?? 'Requester cancellation approved',
    note: 'Dispatcher approved the requester cancellation.',
  });

  const releasedResponders = new Map<string, string>();
  for (const assignment of assignments ?? []) {
    const { error: updateError } = await db()
      .from('request_assignments')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('id', assignment.id)
      .in('status', activeAssignmentStatuses);
    if (updateError) throw ApiError.internal('The request was cancelled, but its responder assignment could not be closed.', updateError.message);

    if (assignment.responder_user_id) {
      const { data: otherAssignment, error: otherAssignmentError } = await db()
        .from('request_assignments')
        .select('id')
        .eq('responder_user_id', assignment.responder_user_id)
        .in('status', activeAssignmentStatuses)
        .limit(1)
        .maybeSingle();
      if (otherAssignmentError) throw ApiError.internal('The request was cancelled, but responder availability could not be checked.', otherAssignmentError.message);
      if (!otherAssignment) {
        const { data: responderProfile, error: responderProfileError } = await db()
          .from('responder_profiles')
          .select('availability, go_offline_after_mission, organisation_id')
          .eq('user_id', assignment.responder_user_id)
          .maybeSingle();
        if (responderProfileError) throw ApiError.internal('The request was cancelled, but responder availability could not be loaded.', responderProfileError.message);

        const availabilityAfterRelease = responderProfile?.go_offline_after_mission
          ? 'offline'
          : responderProfile && ['assigned', 'en_route', 'on_scene'].includes(String(responderProfile.availability))
            ? 'available'
            : responderProfile?.availability;

        if (responderProfile && availabilityAfterRelease && (
          availabilityAfterRelease !== responderProfile.availability || responderProfile.go_offline_after_mission
        )) {
          const { error: responderError } = await db()
            .from('responder_profiles')
            .update({
              availability: availabilityAfterRelease,
              go_offline_after_mission: false,
              updated_at: now,
            })
            .eq('user_id', assignment.responder_user_id);
          if (responderError) throw ApiError.internal('The request was cancelled, but the responder could not be released.', responderError.message);
        }

        const responderOrganisationId = assignment.organisation_id ?? current.organisationId;
        if (availabilityAfterRelease === 'available' && responderOrganisationId) {
          releasedResponders.set(assignment.responder_user_id, responderOrganisationId);
        }
      }
    }

    if (assignment.team_id) {
      const { data: otherAssignment, error: otherAssignmentError } = await db()
        .from('request_assignments')
        .select('id')
        .eq('team_id', assignment.team_id)
        .in('status', activeAssignmentStatuses)
        .limit(1)
        .maybeSingle();
      if (otherAssignmentError) throw ApiError.internal('The request was cancelled, but team availability could not be checked.', otherAssignmentError.message);
      if (!otherAssignment) {
        const { error: teamError } = await db()
          .from('responder_teams')
          .update({ status: 'available', updated_at: now })
          .eq('id', assignment.team_id)
          .eq('status', 'assigned');
        if (teamError) throw ApiError.internal('The request was cancelled, but the response team could not be released.', teamError.message);
      }
    }

    if (assignment.vehicle_id) {
      const { data: otherAssignment, error: otherAssignmentError } = await db()
        .from('request_assignments')
        .select('id')
        .eq('vehicle_id', assignment.vehicle_id)
        .in('status', activeAssignmentStatuses)
        .limit(1)
        .maybeSingle();
      if (otherAssignmentError) throw ApiError.internal('The request was cancelled, but vehicle availability could not be checked.', otherAssignmentError.message);
      if (!otherAssignment) {
        const { error: vehicleError } = await db()
          .from('vehicles')
          .update({ status: 'available', updated_at: now })
          .eq('id', assignment.vehicle_id)
          .eq('status', 'assigned');
        if (vehicleError) throw ApiError.internal('The request was cancelled, but the response vehicle could not be released.', vehicleError.message);
      }
    }
  }

  // Offer newly released responders the oldest eligible request immediately.
  // The responder mission page also polls for queued work, but cancellation
  // approval should not depend on that page being open or its next poll.
  for (const [responderUserId, organisationId] of releasedResponders) {
    try {
      const result = await assignNextQueuedRequest(responderUserId, organisationId);
      if (!result.assigned && result.reason !== 'no_available_responder') {
        console.warn('released_responder_auto_assignment_failed', {
          responderUserId,
          organisationId,
          reason: result.reason,
        });
      }
    } catch (assignmentError) {
      // Cancellation is already committed. Keep it successful if an optional
      // follow-up assignment fails; the responder's mission poll can retry.
      console.warn('released_responder_auto_assignment_failed', {
        responderUserId,
        organisationId,
        error: assignmentError,
      });
    }
  }

  try {
    await notifyRequestCancellationCompleted({
      recipientUserId: current.requesterId,
      requestId,
      reference: current.reference,
      message: `Your cancellation was approved. Request ${current.reference} has been successfully cancelled.`,
    });
  } catch (notificationError) {
    console.warn('requester_cancellation_completion_notification_failed', notificationError);
  }
  try {
    await notifyRequestCancellationCompleted({
      recipientUserId: auth.userId,
      requestId,
      reference: current.reference,
      message: `You approved the cancellation. Request ${current.reference} has been successfully cancelled.`,
    });
  } catch (notificationError) {
    console.warn('approving_dispatcher_cancellation_notification_failed', notificationError);
  }
  const cancellationOrganisationId = assignments?.[0]?.organisation_id ?? current.organisationId;
  if (cancellationOrganisationId) {
    try {
      await notifyOrganisationDispatchers({
        organisationId: cancellationOrganisationId,
        requestId,
        notificationType: 'request_cancelled',
        title: 'Request cancelled',
        message: `The requester cancellation for ${current.reference} was approved. The request is now cancelled.`,
        sensitivity: 'normal',
      });
    } catch (notificationError) {
      console.warn('dispatcher_cancellation_completion_notification_failed', notificationError);
    }
  }
  try {
    await notifyRespondersOfCancellationApproval({
      responderUserIds: (assignments ?? []).map((assignment) => assignment.responder_user_id).filter(Boolean),
      requestId,
      reference: current.reference,
    });
  } catch (notificationError) {
    console.warn('responder_cancellation_approval_notification_failed', notificationError);
  }

  return getRequestDetail(requestId, auth);
}

/* -------------------------------------------------------------------------- */
/* Assignment (Block 6, Person 11)                                             */
/* -------------------------------------------------------------------------- */

export async function assignRequest(
  requestId: string,
  auth: AuthPrincipal,
  input: AssignmentInput,
): Promise<EmergencyRequestDetail> {
  assertCanAct(auth, ['dispatcher', 'admin']);

  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  if (!['submitted', 'received'].includes(current.currentStatus)) {
    throw new ApiError('CONFLICT', 'This request is no longer waiting for assignment.');
  }
  if (current.cancellationRequestedAt) {
    throw new ApiError('CONFLICT', 'This request has a pending cancellation decision.');
  }

  const organisationId = input.organisationId ?? auth.organisationId;
  if (!organisationId) {
    throw new ApiError('BAD_REQUEST', 'This account is not linked to a responding organisation.');
  }
  if (auth.role === 'dispatcher' && organisationId !== auth.organisationId) {
    throw ApiError.forbidden('You can only assign responders from your organisation.');
  }

  const { data: organisation, error: organisationError } = await db()
    .from('organisations')
    .select('organisation_type')
    .eq('id', organisationId)
    .maybeSingle();
  if (organisationError) {
    throw ApiError.internal('Could not verify the organisation response type.', organisationError.message);
  }
  if (!organisation) {
    throw ApiError.notFound('The selected organisation could not be found.');
  }
  if (!organisationTypesForEmergencyCategory(current.category).includes(organisation.organisation_type)) {
    throw new ApiError('BAD_REQUEST', 'This organisation does not handle the selected emergency category.');
  }

  if (input.responderUserId) {
    const { data: responder, error: responderError } = await db()
      .from('responder_profiles')
      .select('user_id, organisation_id, availability')
      .eq('user_id', input.responderUserId)
      .maybeSingle();

    if (responderError) {
      throw ApiError.internal('Could not verify responder availability.', responderError.message);
    }

    if (!responder || responder.organisation_id !== organisationId) {
      throw new ApiError('BAD_REQUEST', 'That responder is not part of the selected organisation.');
    }

    if (responder.availability !== 'available') {
      throw new ApiError('CONFLICT', 'That responder is offline or already assigned and cannot receive a new request.');
    }

    const { data: activeResponderAssignment, error: activeResponderAssignmentError } = await db()
      .from('request_assignments')
      .select('id, request_id')
      .eq('responder_user_id', input.responderUserId)
      .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived'])
      .limit(1)
      .maybeSingle();

    if (activeResponderAssignmentError) {
      throw ApiError.internal(
        'Could not verify whether that responder is already assigned.',
        activeResponderAssignmentError.message,
      );
    }

    if (activeResponderAssignment) {
      throw new ApiError('CONFLICT', 'That responder is already assigned to another active request.');
    }
  }

  const { data: assignment, error } = await db()
    .from('request_assignments')
    .insert({
      request_id: requestId,
      organisation_id: organisationId,
      responder_user_id: input.responderUserId ?? null,
      team_id: input.teamId ?? null,
      vehicle_id: input.vehicleId ?? null,
      assigned_by_user_id: auth.userId,
      status: 'assigned',
      eta_minutes: input.etaMinutes ?? null,
      assignment_note: input.assignmentNote ?? null,
    })
    .select('id')
    .single();

  if (error) {
    if (
      isUniqueViolation(error) &&
      (error.message.includes('one_active_assignment_per_request') ||
        error.message.includes('request_assignments_one_active_per_request') ||
        error.message.includes('request_assignments_one_active_per_responder'))
    ) {
      throw new ApiError(
        'CONFLICT',
        error.message.includes('request_assignments_one_active_per_request')
          ? 'This request already has an active assignment.'
          : 'This responder is already assigned to another active request.',
      );
    }
    throw ApiError.internal('Could not create that assignment.', error.message);
  }

  // Routing the request to the organisation is what makes it visible on that
  // organisation's board.
  await db()
    .from('emergency_requests')
    .update({ routed_organisation_id: organisationId })
    .eq('id', requestId);

  if (current.currentStatus !== 'assigned') {
    try {
      const request = await changeStatus(requestId, auth, {
        status: 'assigned',
        etaMinutes: input.etaMinutes,
        reason: 'Responder assigned',
      });
      const { error: requesterNotificationError } = await db().from('notifications').insert({
        recipient_user_id: current.requesterId,
        request_id: requestId,
        notification_type: 'driver_found',
        title: 'Responder assigned',
        message: input.etaMinutes ? `A responder has been assigned. Estimated arrival: ${input.etaMinutes} minutes.` : 'A responder has been assigned to your emergency request.',
        sensitivity: 'normal',
      });
      if (requesterNotificationError) console.error('Assignment notification error:', requesterNotificationError.message);
      return request;
    } catch (assignmentError) {
      const latest = await getRequestSummary(requestId).catch(() => null);
      if (latest?.currentStatus !== 'assigned') {
        const now = new Date().toISOString();
        const { error: releaseError } = await db()
          .from('request_assignments')
          .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
          .eq('id', assignment.id)
          .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived']);
        if (releaseError) console.error('Could not release an assignment after its request became unavailable:', releaseError.message);
      }
      throw assignmentError;
    }
  }

  const { error: requesterNotificationError } = await db().from('notifications').insert({
    recipient_user_id: current.requesterId,
    request_id: requestId,
    notification_type: 'driver_found',
    title: 'Responder assigned',
    message: input.etaMinutes ? `A responder has been assigned. Estimated arrival: ${input.etaMinutes} minutes.` : 'A responder has been assigned to your emergency request.',
    sensitivity: 'normal',
  });
  if (requesterNotificationError) console.error('Assignment notification error:', requesterNotificationError.message);

  return getRequestDetail(requestId, auth);
}

/* -------------------------------------------------------------------------- */
/* Notes (Block 6, Person 12)                                                  */
/* -------------------------------------------------------------------------- */

export async function addNote(
  requestId: string,
  auth: AuthPrincipal,
  input: NoteInput,
): Promise<OperationalNote> {
  assertCanAct(auth, ['responder', 'dispatcher', 'admin']);

  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  const { data, error } = await db()
    .from('operational_notes')
    .insert({
      request_id: requestId,
      author_user_id: auth.userId,
      note: input.note,
      requester_visible: input.requesterVisible,
    })
    .select(
      'id, author_user_id, note, requester_visible, created_at, ' +
        'author:users ( id, first_name, last_name, display_name )',
    )
    .single();

  if (error) throw ApiError.internal('Could not save that note.', error.message);
  return mapNote(data);
}

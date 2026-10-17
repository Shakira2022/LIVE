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
 *   assignments.assigned_by    -> assigned_by_user_id (NOT NULL)
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
import { chooseOrganisation, type RoutingDecision } from '@/lib/middleware/server/routing-service';
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
  if (auth.role === 'requester' || options.scope === 'mine') {
    query = query.eq('requester_id', auth.userId);
  } else if (auth.role !== 'admin' && auth.role !== 'auditor') {
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
    query = query.in('current_status', options.status.split(',').map((s) => s.trim()));
  }
  if (options.search) {
    query = query.ilike('reference_code', `%${options.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw ApiError.internal('Could not load requests.', error.message);

  return { items: (data ?? []).map(mapSummary), total: count ?? 0 };
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

  const [history, assignments, notes] = await Promise.all([
    db()
      .from('request_status_history')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true }),
    db()
      .from('request_assignments')
      .select(
        'id, organisation_id, responder_user_id, team_id, vehicle_id, status, eta_minutes, ' +
          'assignment_note, assigned_at, acknowledged_at, route_started_at, arrived_at, completed_at, ' +
          'responder:responder_profiles ( employee_number, current_latitude, current_longitude, user:users ( id, first_name, last_name, display_name ) ), ' +
          'team:responder_teams ( id, name ), vehicle:vehicles ( id, call_sign, registration_number )',
      )
      .eq('request_id', id)
      .order('assigned_at', { ascending: true }),
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

  // A requester sees only the notes staff explicitly marked visible to them.
  const noteRows = (notes.data ?? []) as unknown as Array<{ requester_visible: boolean }>;
  const visibleNotes = noteRows.filter(
    (row) => auth.role !== 'requester' || row.requester_visible,
  );

  const row = data as Record<string, unknown>;

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
    assignments: (assignments.data ?? []).map(mapAssignment),
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

  if (existingAssignmentError || existingAssignment) {
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

  if (responderError || !responders?.length) {
    return { assigned: false, reason: "no_available_responder" };
  }

  const ordered = (responders as AvailableResponder[])
    .filter((responder) => responder.current_latitude !== null && responder.current_longitude !== null)
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

    if (claimError || !claimed) continue;

    const { data: assignment, error: assignmentError } = await db()
      .from("request_assignments")
      .insert({
        request_id: input.requestId,
        organisation_id: input.organisationId,
        responder_user_id: responder.user_id,
        assigned_by_user_id: null,
        status: "assigned",
        eta_minutes: etaMinutes,
        assignment_note: "Assigned automatically to the nearest available responder.",
      })
      .select("id")
      .single();

    if (assignmentError) {
      await db().from("responder_profiles").update({ availability: "available", updated_at: now }).eq("user_id", responder.user_id);
      return { assigned: false, reason: "assignment_failed" };
    }

    const { error: requestError } = await db()
      .from("emergency_requests")
      .update({
        current_status: "assigned",
        received_at: now,
        assigned_at: now,
        eta_minutes: etaMinutes,
        estimated_arrival_at: new Date(Date.now() + etaMinutes * 60_000).toISOString(),
      })
      .eq("id", input.requestId);

    if (requestError) {
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
    ]);

    return { assigned: true, responderUserId: responder.user_id, etaMinutes };
  }

  return { assigned: false, reason: "claim_failed" };
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
    .eq("is_active", true)
    .order("submitted_at", { ascending: true })
    .limit(20);

  if (error || !queued?.length) {
    return { assigned: false, reason: "no_available_responder" };
  }

  for (const row of queued as Array<{ id: string }>) {
    const { data: location } = await db()
      .from("request_locations")
      .select("latitude, longitude")
      .eq("request_id", row.id)
      .maybeSingle();

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
    .select('id, routed_organisation_id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as { id: string; routed_organisation_id: string | null };
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
    .eq('is_active', true)
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

      // Dispatch is the exception path, not the normal assignment path. A
      // request is automatically assigned only to an online responder in the
      // routed organisation; when none can be safely claimed it stays on the
      // dispatcher queue for human triage.
      if (input.latitude !== undefined && input.longitude !== undefined) {
        try {
          await automaticallyAssignNearestResponder({
            requestId,
            organisationId: routing.organisationId,
            latitude: input.latitude,
            longitude: input.longitude,
          });
        } catch {
          // Assignment automation must never prevent a received emergency
          // request from reaching the dispatcher fallback queue.
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

  if (existingAssignment) {
    throw new ApiError('CONFLICT', 'This emergency is already assigned to a responder.');
  }

  const target = input.status as RequestStatus;

  // Optimistic concurrency: refuse if the board moved under the operator.
  if (input.expectedStatus && input.expectedStatus !== current.currentStatus) {
    throw new ApiError(
      'CONFLICT',
      `Someone already moved this request to ${current.currentStatus}. Reload and try again.`,
    );
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

  const { error } = await db()
    .from('emergency_requests')
    .update(patch)
    .eq('id', requestId)
    // Guard against a concurrent writer that changed the row since the read.
    .eq('current_status', current.currentStatus);

  if (error) throw ApiError.internal('Could not update that request.', error.message);

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

/** A requester past 'submitted' asks; staff confirm. */
export async function requestCancellation(
  requestId: string,
  auth: AuthPrincipal,
  reason?: string,
): Promise<EmergencyRequestDetail> {
  const current = await getRequestSummary(requestId);
  assertCanView(current, auth);

  if (current.requesterId !== auth.userId) throw ApiError.forbidden();

  const { error } = await db()
    .from('emergency_requests')
    .update({
      cancellation_requested_at: new Date().toISOString(),
      cancellation_reason: reason ?? null,
    })
    .eq('id', requestId);

  if (error) throw ApiError.internal('Could not record that request.', error.message);
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

  const organisationId = input.organisationId ?? auth.organisationId;
  if (!organisationId) {
    throw new ApiError('BAD_REQUEST', 'This account is not linked to a responding organisation.');
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
  }

  const { error } = await db()
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
    });

  if (error) {
    if (isUniqueViolation(error) && error.message.includes('one_active_assignment_per_request')) {
      throw new ApiError('CONFLICT', 'This emergency is already assigned to a responder.');
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
    return changeStatus(requestId, auth, {
      status: 'assigned',
      etaMinutes: input.etaMinutes,
      reason: 'Responder assigned',
    });
  }

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

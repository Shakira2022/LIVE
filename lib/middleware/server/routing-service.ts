/**
 * NEAREST-ORGANISATION ROUTING  (Block 4 Person 4, Block 5 Person 7)
 *
 * Decides which responding organisation a new emergency request is sent to,
 * by straight-line distance from the incident pin, checking each organisation
 * in order for an available responder before moving farther away.
 *
 * WHY THIS EXISTS
 *   Before this, `routed_organisation_id` was only ever set when a dispatcher
 *   manually assigned a responder. Every new request therefore arrived
 *   unrouted, and the UI fell back to whichever organisation happened to be
 *   first in the seed data - which is why a request raised outside Gauteng
 *   still showed a Johannesburg hospital.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - No travel time, no traffic, no road network. This is great-circle
 *     distance. A hospital 3 km away across a river may be further by road
 *     than one 6 km away. Documented as a known limitation, not hidden.
 *   - Straight-line distance only. It does not model road access, traffic, or
 *     dispatch travel time.
 *   - No automatic re-routing. Once assigned, a human moves it.
 *
 * SAFETY PROPERTY: routing NEVER blocks a submission. If no organisation can
 * be chosen - none seeded, none with coordinates, none within range, or the
 * query simply fails - the request is still created with
 * `routed_organisation_id = null`. Unrouted requests remain visible to every
 * dispatcher (see listRequests), so the worst case is a human triages it. An
 * emergency must never fail to record because a lookup table was empty.
 */

import 'server-only';
import { db } from '@/lib/middleware/server/db';
import { haversineMetres } from '@/lib/middleware/geo';
import { createLogger } from '@/lib/middleware/logger';

const log = createLogger({ logType: 'application', route: 'routing' });

/**
 * Only these organisation types receive emergencies. 'administration' and
 * 'support' exist in the enum but are back-office - routing an emergency to
 * them would be worse than leaving it unrouted.
 */
const RESPONDING_TYPES = [
  'medical', 'firefighter', 'police',
] as const;

/** Return only the organisation type allowed to handle this request category. */
export function organisationTypesForEmergencyCategory(category?: string | null): string[] {
  const normalized = String(category ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/fire|firefighter|firefighting|rescue/.test(normalized)) {
    return ['firefighter'];
  }
  if (/police|crime|robbery|personal_safety|suspicious|shots_fired/.test(normalized)) {
    return ['police'];
  }
  if (/medical|accident|injury|trauma|unconscious|breathing|vehicle/.test(normalized)) return ['medical'];
  return [];
}

/**
 * Beyond this, "nearest" stops being meaningful. If the closest responder is
 * 40 km away, silently routing there looks like a decision was made when
 * really there is no coverage - a dispatcher should see it as unrouted and
 * escalate. Override with ROUTING_MAX_RADIUS_KM.
 */
function maxRadiusMetres(): number {
  const km = Number(process.env.ROUTING_MAX_RADIUS_KM);
  // Keep the dispatcher local even if an environment file contains an old,
  // overly broad radius. Operators may tighten coverage below 40 km.
  return Math.min(Number.isFinite(km) && km > 0 ? km : 40, 40) * 1000;
}

export interface OrganisationCandidate {
  id: string;
  name: string;
  organisationType: string;
  latitude: number;
  longitude: number;
  distanceMetres: number;
}

interface OrgRow {
  id: string;
  name: string;
  organisation_type: string;
  latitude: string | number | null;
  longitude: string | number | null;
}

/**
 * Every active responding organisation that has coordinates, ordered by
 * distance from the given point.
 *
 * The whole table is read and sorted in Node rather than in SQL. That is the
 * right trade at this scale - tens of organisations - and avoids requiring the
 * PostGIS extension or a raw RPC. If this ever reaches thousands of rows,
 * replace it with an `earthdistance`/PostGIS query rather than paginating here.
 */
export async function rankOrganisationsByDistance(
  point: { latitude: number; longitude: number },
  options: { limit?: number; withinMetres?: number; organisationTypes?: string[] } = {},
): Promise<OrganisationCandidate[]> {
  const { data, error } = await db()
    .from('organisations')
    .select('id, name, organisation_type, latitude, longitude')
    .eq('status', 'active')
    .in('organisation_type', options.organisationTypes ?? [...RESPONDING_TYPES])
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    log.error('organisation_lookup_failed', { dbError: error.message });
    return [];
  }

  const withinMetres = options.withinMetres ?? maxRadiusMetres();

  const ranked = ((data ?? []) as OrgRow[])
    .map((row) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        id: row.id,
        name: row.name,
        organisationType: row.organisation_type,
        latitude,
        longitude,
        distanceMetres: haversineMetres(point, { latitude, longitude }),
      };
    })
    .filter((c): c is OrganisationCandidate => c !== null)
    .filter((c) => c.distanceMetres <= withinMetres)
    .sort((a, b) => a.distanceMetres - b.distanceMetres);

  return options.limit ? ranked.slice(0, options.limit) : ranked;
}

export interface RoutingDecision {
  organisationId: string | null;
  organisationName: string | null;
  distanceMetres: number | null;
  /** Why this outcome happened. Goes into the audit metadata. */
  reason:
    | 'routed'
    | 'no_coordinates'
    | 'no_candidates'
    | 'none_in_range'
    | 'no_available_organisation'
    | 'lookup_failed';
  /** How many organisations were considered, for the audit trail. */
  candidateCount: number;
}

/**
 * Prefer an organisation that can actually receive or act on the request.
 * A nearby hospital with no dispatch staff or available responders should not
 * hide a closer operationally staffed response organisation from dispatch.
 */
async function nearestOperationalOrganisation(
  candidates: OrganisationCandidate[],
  incidentPoint: { latitude: number; longitude: number },
): Promise<OrganisationCandidate | null> {
  const organisationIds = candidates.map((candidate) => candidate.id);
  if (!organisationIds.length) return null;

  const { data: profiles, error: profilesError } = await db()
    .from('responder_profiles')
    .select('user_id, organisation_id, current_latitude, current_longitude')
    .in('organisation_id', organisationIds)
    .eq('availability', 'available')
    .not('current_latitude', 'is', null)
    .not('current_longitude', 'is', null);

  if (profilesError) {
    log.error('routing_responder_lookup_failed', { dbError: profilesError.message });
    return null;
  }
  if (profiles?.length) {
    const responderIds = [...new Set(profiles.map((profile) => profile.user_id))];
    const { data: activeResponders, error: usersError } = await db()
      .from('users')
      .select('id')
      .in('id', responderIds)
      .eq('role', 'responder')
      .eq('status', 'active')
      .is('deleted_at', null);

    if (usersError) {
      log.error('routing_responder_account_lookup_failed', { dbError: usersError.message });
      return null;
    }
    if (activeResponders?.length) {
      const activeResponderIds = new Set(activeResponders.map((user) => user.id));
      const activeProfiles = profiles.filter((profile) => activeResponderIds.has(profile.user_id));
      const { data: assignments, error: assignmentError } = await db()
        .from('request_assignments')
        .select('request_id, responder_user_id')
        .in('responder_user_id', responderIds)
        .not('responder_user_id', 'is', null)
        .in('status', ['assigned', 'acknowledged', 'en_route', 'arrived']);
      if (assignmentError) {
        log.error('routing_active_assignment_lookup_failed', { dbError: assignmentError.message });
        return null;
      }
      const assignmentRows = assignments ?? [];
      const requestIds = [...new Set(assignmentRows.map((assignment) => assignment.request_id))];
      const { data: requests, error: requestError } = requestIds.length
        ? await db().from('emergency_requests').select('id, current_status').in('id', requestIds)
        : { data: [], error: null };
      if (requestError) {
        log.error('routing_active_request_lookup_failed', { dbError: requestError.message });
        return null;
      }
      const openRequestIds = new Set((requests ?? [])
        .filter((request) => ['submitted', 'received', 'assigned', 'en_route', 'arrived'].includes(String(request.current_status).toLowerCase()))
        .map((request) => request.id));
      const busyResponderIds = new Set(assignmentRows
        .filter((assignment) => openRequestIds.has(assignment.request_id))
        .map((assignment) => assignment.responder_user_id)
        .filter(Boolean));
      const availableOrganisationIds = new Set(
        activeProfiles
          .filter((profile) => !busyResponderIds.has(profile.user_id))
          .filter((profile) => profile.current_latitude != null && profile.current_longitude != null)
          .filter((profile) => haversineMetres(incidentPoint, {
            latitude: Number(profile.current_latitude),
            longitude: Number(profile.current_longitude),
          }) <= maxRadiusMetres())
          .map((profile) => profile.organisation_id),
      );
      // candidates are ordered by the organisation's confirmed map pin.
      // Check the nearest one first; if it has no available responder, try
      // the next organisation in the same local coverage radius.
      return candidates.find((candidate) => availableOrganisationIds.has(candidate.id)) ?? null;
    }
  }
  return null;
}

/**
 * Picks the organisation for an incident at this point. Never throws.
 */
export async function chooseOrganisation(point: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  category?: string;
}): Promise<RoutingDecision> {
  const empty = (reason: RoutingDecision['reason'], candidateCount = 0): RoutingDecision => ({
    organisationId: null,
    organisationName: null,
    distanceMetres: null,
    reason,
    candidateCount,
  });

  const { latitude, longitude } = point;

  // A manual address with no coordinates is stored as the 0,0 sentinel (see
  // saveLocation). Routing on that would send every address-only request to
  // whichever organisation is nearest the Gulf of Guinea.
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    (latitude === 0 && longitude === 0)
  ) {
    return empty('no_coordinates');
  }

  try {
    // Rank without the radius filter first, so "there are organisations but
    // none near you" is distinguishable from "there are none at all". Those
    // are different problems and want different fixes.
    const organisationTypes = organisationTypesForEmergencyCategory(point.category);
    if (!organisationTypes.length) return empty('no_candidates');
    const all = await rankOrganisationsByDistance(
      { latitude, longitude },
      {
        withinMetres: Number.POSITIVE_INFINITY,
        organisationTypes,
      },
    );

    if (all.length === 0) return empty('no_candidates');

    const inRange = all.filter((candidate) => candidate.distanceMetres <= maxRadiusMetres());
    if (!inRange.length) {
      const nearest = all[0];
      log.warn('no_organisation_in_range', {
        nearestKm: Math.round(nearest.distanceMetres / 1000),
        maxKm: Math.round(maxRadiusMetres() / 1000),
        candidateCount: all.length,
      });
      return empty('none_in_range', all.length);
    }

    const nearest = await nearestOperationalOrganisation(inRange, { latitude, longitude });
    if (!nearest) return empty('no_available_organisation', all.length);

    return {
      organisationId: nearest.id,
      organisationName: nearest.name,
      distanceMetres: Math.round(nearest.distanceMetres),
      reason: 'routed',
      candidateCount: all.length,
    };
  } catch (error) {
    // Routing must never be the reason an emergency fails to submit.
    log.error('routing_threw', { cause: String(error) });
    return empty('lookup_failed');
  }
}

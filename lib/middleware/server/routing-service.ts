/**
 * NEAREST-ORGANISATION ROUTING  (Block 4 Person 4, Block 5 Person 7)
 *
 * Decides which responding organisation a new emergency request is sent to,
 * by straight-line distance from the incident.
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
 *   - No capacity or availability check. Routing to the nearest organisation
 *     does not mean it has a free ambulance. Dispatch still decides.
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
const RESPONDING_TYPES = ['hospital', 'emergency_response'] as const;

/**
 * Beyond this, "nearest" stops being meaningful. If the closest responder is
 * 400 km away, silently routing there looks like a decision was made when
 * really there is no coverage - a dispatcher should see it as unrouted and
 * escalate. Override with ROUTING_MAX_RADIUS_KM.
 */
function maxRadiusMetres(): number {
  const km = Number(process.env.ROUTING_MAX_RADIUS_KM);
  return (Number.isFinite(km) && km > 0 ? km : 150) * 1000;
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
  options: { limit?: number; withinMetres?: number } = {},
): Promise<OrganisationCandidate[]> {
  const { data, error } = await db()
    .from('organisations')
    .select('id, name, organisation_type, latitude, longitude')
    .eq('status', 'active')
    .in('organisation_type', RESPONDING_TYPES as unknown as string[])
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
    | 'lookup_failed';
  /** How many organisations were considered, for the audit trail. */
  candidateCount: number;
}

/**
 * Picks the organisation for an incident at this point. Never throws.
 */
export async function chooseOrganisation(point: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
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
    const all = await rankOrganisationsByDistance(
      { latitude, longitude },
      { withinMetres: Number.POSITIVE_INFINITY },
    );

    if (all.length === 0) return empty('no_candidates');

    const nearest = all[0];
    if (nearest.distanceMetres > maxRadiusMetres()) {
      log.warn('no_organisation_in_range', {
        nearestKm: Math.round(nearest.distanceMetres / 1000),
        maxKm: Math.round(maxRadiusMetres() / 1000),
        candidateCount: all.length,
      });
      return empty('none_in_range', all.length);
    }

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

import 'server-only';

import { db } from '@/lib/middleware/server/db';

export type MapCenter = { lat: number; lng: number };

function coordinates(latitude: unknown, longitude: unknown): MapCenter | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return null;
  }
  return { lat, lng };
}

const CITY_CENTRES: Record<string, MapCenter> = {
  vereeniging: { lat: -26.6736, lng: 27.9261 },
  vanderbijlpark: { lat: -26.7117, lng: 27.8379 },
  polokwane: { lat: -23.9045, lng: 29.4689 },
  bloemfontein: { lat: -29.0852, lng: 26.1596 },
  'cape town': { lat: -33.9249, lng: 18.4241 },
  durban: { lat: -29.8587, lng: 31.0218 },
  johannesburg: { lat: -26.2041, lng: 28.0473 },
  pretoria: { lat: -25.7479, lng: 28.2293 },
  tshwane: { lat: -25.7479, lng: 28.2293 },
  mbombela: { lat: -25.4753, lng: 30.9694 },
  nelspruit: { lat: -25.4753, lng: 30.9694 },
  kimberley: { lat: -28.7282, lng: 24.7499 },
  rustenburg: { lat: -25.6676, lng: 27.2421 },
  mahikeng: { lat: -25.8652, lng: 25.6442 },
  mafikeng: { lat: -25.8652, lng: 25.6442 },
  'gqeberha': { lat: -33.9608, lng: 25.6022 },
  'port elizabeth': { lat: -33.9608, lng: 25.6022 },
  'east london': { lat: -33.0153, lng: 27.9116 },
};

const PROVINCE_CENTRES: Record<string, MapCenter> = {
  'eastern cape': { lat: -32.3, lng: 26.4 },
  'free state': { lat: -28.6, lng: 26.8 },
  gauteng: { lat: -26.1, lng: 28.2 },
  kwazulu_natal: { lat: -29.6, lng: 30.4 },
  'kwazulu-natal': { lat: -29.6, lng: 30.4 },
  'kwazulu natal': { lat: -29.6, lng: 30.4 },
  'kwa-zulu natal': { lat: -29.6, lng: 30.4 },
  limpopo: { lat: -23.9, lng: 29.45 },
  mpumalanga: { lat: -25.5, lng: 30.8 },
  'north west': { lat: -26.7, lng: 25.5 },
  'northern cape': { lat: -29.7, lng: 22.1 },
  'western cape': { lat: -33.9, lng: 18.6 },
};

const ORGANISATION_CENTRES: Record<string, MapCenter> = {
  'vaal medical hospital': { lat: -26.6736, lng: 27.9261 },
};

/** Resolve a useful regional map centre without defaulting every organisation to Johannesburg. */
export async function getOrganisationMapCenter(
  organisationId: string,
): Promise<MapCenter | null> {
  const client = db();
  const { data: organisation, error } = await client
    .from('organisations')
    .select('name,latitude,longitude,city,suburb,province')
    .eq('id', organisationId)
    .maybeSingle();

  if (error) throw new Error(`Could not load organisation map location: ${error.message}`);
  if (!organisation) return null;

  const savedLocation = coordinates(organisation.latitude, organisation.longitude);
  if (savedLocation) return savedLocation;

  const organisationName = typeof organisation.name === 'string'
    ? organisation.name.trim().toLowerCase()
    : '';

  const localityNames = [organisation.city, organisation.suburb]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  for (const locality of localityNames) {
    if (CITY_CENTRES[locality]) return CITY_CENTRES[locality];
  }

  if (ORGANISATION_CENTRES[organisationName]) return ORGANISATION_CENTRES[organisationName];

  const provinceKey = typeof organisation.province === 'string'
    ? organisation.province.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
  return PROVINCE_CENTRES[provinceKey] ?? null;
}

/** Geospatial helpers shared by the tracking UI and the server. */

const EARTH_RADIUS_M = 6_371_000;

export function haversineMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

export function formatAccuracy(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return 'unknown';
  return metres < 1000 ? `±${Math.round(metres)} m` : `±${(metres / 1000).toFixed(1)} km`;
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;
}

/** Key-free OpenStreetMap embed. No provider account is needed for the prototype. */
export function osmEmbedUrl(latitude: number, longitude: number, spanDeg = 0.006): string {
  const left = longitude - spanDeg;
  const right = longitude + spanDeg;
  const top = latitude + spanDeg / 2;
  const bottom = latitude - spanDeg / 2;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

/** FR-024: route guidance opened in the responder's own mapping application. */
export function routeLinkUrl(latitude: number, longitude: number, provider = 'google'): string {
  if (provider === 'osm') {
    return `https://www.openstreetmap.org/directions?to=${latitude}%2C${longitude}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Human-readable request reference (FR-031).
 * Format: ER-YYMMDD-XXXX using an unambiguous alphabet (no O/0, I/1).
 */

const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReference(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `ER-${yy}${mm}${dd}-${suffix}`;
}

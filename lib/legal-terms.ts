export const CURRENT_TERMS_VERSION = "2026-11-01";

export function hasAcceptedCurrentTerms(user: {
  termsAcceptedAt: string | null;
  termsAcceptedVersion: string | null;
}) {
  return Boolean(user.termsAcceptedAt && user.termsAcceptedVersion === CURRENT_TERMS_VERSION);
}

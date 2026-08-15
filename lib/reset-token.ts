import crypto from "crypto";

export function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return {
    rawToken,
    tokenHash,
  };
}

export function hashToken(rawToken: string) {
  return crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
}
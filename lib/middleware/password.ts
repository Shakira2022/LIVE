/**
 * Password hashing. Node runtime only - bcryptjs cannot run on the Edge.
 * SRS 7.1: password values shall never be stored in plain text.
 */

import bcrypt from 'bcryptjs';

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Constant-ish work factor even when the account does not exist, so that
 * response timing does not reveal which identifiers are registered.
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMy.MH/rMH7z6f2P.RRfjKPMh1ZzHqTVMKq';
export async function burnPasswordTime(): Promise<void> {
  await bcrypt.compare('not-a-real-password', DUMMY_HASH);
}

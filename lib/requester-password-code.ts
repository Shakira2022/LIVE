import "server-only";
import { createHmac } from "node:crypto";

import { serverEnv } from "@/lib/middleware/env";

export function hashRequesterPasswordCode(code: string) {
  return createHmac("sha256", serverEnv.jwtSecret).update(code).digest("hex");
}

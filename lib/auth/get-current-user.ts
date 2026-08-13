import { verifyAccessToken } from "@/lib/auth/jwt";

export async function getCurrentUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);

  return await verifyAccessToken(token);
}
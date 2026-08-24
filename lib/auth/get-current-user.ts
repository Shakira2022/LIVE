import { verifyAccessToken } from "@/lib/auth/jwt";
import { cookies } from "next/headers";

export async function getCurrentUser(request?: Request) {
  // First try the Authorization header
  if (request) {
    const authHeader = request.headers.get("authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();

      if (token) {
        return await verifyAccessToken(token);
      }
    }
  }

  // If there is no Authorization header, try the HTTP-only cookie
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;

  if (!accessToken) {
    return null;
  }

  return await verifyAccessToken(accessToken);
}
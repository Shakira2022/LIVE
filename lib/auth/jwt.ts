import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/lib/types";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
}

const secret = new TextEncoder().encode(JWT_SECRET);

export interface AccessTokenPayload {
    userId: string;
    role: UserRole;
    jti: string;
}

export async function createAccessToken(
    userId: string,
    role: UserRole,
): Promise<string> {
    const tokenId = crypto.randomUUID();

    return new SignJWT({
        userId,
        role,
    })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(userId)
        .setJti(tokenId)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(secret);
}

export async function verifyAccessToken(
    token: string,
): Promise<AccessTokenPayload | null> {
    try {
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
        });

        if (
            typeof payload.userId !== "string" ||
            typeof payload.role !== "string" ||
            typeof payload.jti !== "string"
        ) {
            return null;
        }

        const validRoles: UserRole[] = [
            "requester",
            "dispatcher",
            "responder",
            "admin",
            "auditor",
        ];

        if (!validRoles.includes(payload.role as UserRole)) {
            return null;
        }

        return {
            userId: payload.userId,
            role: payload.role as UserRole,
            jti: payload.jti,
        };
    } catch {
        return null;
    }
}
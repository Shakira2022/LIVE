import { NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";

export async function GET(request: Request) {
    try {
        const authorization = request.headers.get("authorization");

        if (!authorization) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Authentication required.",
                },
                { status: 401 },
            );
        }

        if (!authorization.startsWith("Bearer ")) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Invalid authorization header.",
                },
                { status: 401 },
            );
        }

        const token = authorization
            .slice("Bearer ".length)
            .trim();

        if (!token) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Authentication token is missing.",
                },
                { status: 401 },
            );
        }

        const payload = await verifyAccessToken(token);

        if (!payload) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Invalid or expired authentication token.",
                },
                { status: 401 },
            );
        }

        return NextResponse.json({
            ok: true,
            user: {
                id: payload.userId,
                role: payload.role,
            },
            tokenId: payload.jti,
        });
    } catch {
        return NextResponse.json(
            {
                ok: false,
                message: "Unable to verify authentication.",
            },
            { status: 500 },
        );
    }
}
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication required.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.userId,
        role: user.role,
      },
      tokenId: user.jti,
    });
  } catch (error) {
    console.error("Auth me error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to verify authentication.",
      },
      { status: 500 }
    );
  }
}
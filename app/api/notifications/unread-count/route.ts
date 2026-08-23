import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export async function GET(request: Request) {
  try {
    const session = await getCurrentUser(request);

    if (!session) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication is required.",
        },
        { status: 401 },
      );
    }

    const { count, error } = await supabaseServer
      .from("notifications")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("recipient_user_id", session.userId)
      .is("read_at", null);

    if (error) {
      console.error("Unread notification count error:", error);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to retrieve unread notification count.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      unreadCount: count ?? 0,
    });
  } catch (error) {
    console.error("Unread count GET error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to retrieve unread notification count.",
      },
      { status: 500 },
    );
  }
}
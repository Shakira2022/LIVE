import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
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

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          ok: false,
          message: "Notification ID is required.",
        },
        { status: 400 },
      );
    }

    const { data: notification, error: findError } =
      await supabaseServer
        .from("notifications")
        .select("id, recipient_user_id, read_at")
        .eq("id", id)
        .eq("recipient_user_id", session.userId)
        .maybeSingle();

    if (findError) {
      console.error(
        "Notification lookup error:",
        findError,
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to find notification.",
        },
        { status: 500 },
      );
    }

    if (!notification) {
      return NextResponse.json(
        {
          ok: false,
          message: "Notification not found.",
        },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({}));

    const read =
      typeof body.read === "boolean" ? body.read : true;

    const { data, error } = await supabaseServer
      .from("notifications")
      .update({
        read_at: read ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("recipient_user_id", session.userId)
      .select(
        "id, recipient_user_id, request_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
      )
      .single();

    if (error) {
      console.error(
        "Notification update error:",
        error,
      );

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to update notification.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      notification: data,
    });
  } catch (error) {
    console.error("Notification PATCH error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to update notification.",
      },
      { status: 500 },
    );
  }
}
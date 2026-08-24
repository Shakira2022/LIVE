import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { createNotification } from "@/lib/notifications/service";
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

    const { data, error } = await supabaseServer
      .from("notifications")
      .select(
        "id, recipient_user_id, request_id, notification_type, title, message, sensitivity, created_at, read_at, expires_at",
      )
      .eq("recipient_user_id", session.userId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("Notification fetch error:", error);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to retrieve notifications.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      notifications: data ?? [],
    });
  } catch (error) {
    console.error("Notifications GET error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to retrieve notifications.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

    const body = await request.json();

    const {
      recipientUserId,
      requestId,
      notificationType,
      title,
      message,
      sensitivity,
      expiresAt,
    } = body;

    if (
      !recipientUserId ||
      !notificationType ||
      !title ||
      !message
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "recipientUserId, notificationType, title and message are required.",
        },
        { status: 400 },
      );
    }

    const notification = await createNotification({
      recipientUserId,
      requestId,
      notificationType,
      title,
      message,
      sensitivity,
      expiresAt,
    });

    return NextResponse.json(
      {
        ok: true,
        notification,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Notifications POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to create notification.",
      },
      { status: 500 },
    );
  }
}
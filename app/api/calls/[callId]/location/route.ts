import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ callId: z.string().trim().min(1).max(120) });
const ACTIVE_REQUEST_STATUSES = ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"];
const ACTIVE_ASSIGNMENT_STATUSES = ["assigned", "acknowledged", "en_route", "arrived"];

function validCoordinates(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

export const GET = createHandler(
  {
    name: "calls.caller_location",
    auth: "required",
    roles: ["dispatcher"],
    params: paramsSchema,
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const client = db();
    const { data: call, error: callError } = await client
      .from("call_records")
      .select("caller_user_id,callee_user_id,status,ended_at")
      .eq("call_id", ctx.params.callId)
      .maybeSingle();

    if (callError) throw ApiError.internal("Unable to verify this call.", callError.message);
    if (!call || call.ended_at || !["ringing", "accepted"].includes(String(call.status))) {
      throw ApiError.notFound("This active call was not found.");
    }

    const { data: notification, error: notificationError } = await client
      .from("notifications")
      .select("request_id")
      .eq("call_id", ctx.params.callId)
      .eq("recipient_user_id", ctx.user.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (notificationError) throw ApiError.internal("Unable to find the active request for this call.", notificationError.message);
    if (call.callee_user_id !== ctx.user.userId && !notification) throw ApiError.notFound("This active call was not found.");
    if (!notification?.request_id) throw ApiError.notFound("No active request is attached to this call.");

    const { data: caller, error: callerError } = await client
      .from("users")
      .select("id,role")
      .eq("id", call.caller_user_id)
      .maybeSingle();
    if (callerError) throw ApiError.internal("Unable to verify the caller.", callerError.message);
    if (!caller || !["requester", "responder"].includes(String(caller.role))) {
      throw ApiError.notFound("Caller location is available only for requesters and responders.");
    }

    const { data: request, error: requestError } = await client
      .from("emergency_requests")
      .select("id,requester_id,current_status")
      .eq("id", notification.request_id)
      .maybeSingle();
    if (requestError) throw ApiError.internal("Unable to load the active request.", requestError.message);
    if (!request || !ACTIVE_REQUEST_STATUSES.includes(String(request.current_status).toLowerCase())) {
      throw ApiError.notFound("The request attached to this call is no longer active.");
    }

    if (caller.role === "requester") {
      if (request.requester_id !== caller.id) throw ApiError.notFound();
      const { data: location, error: locationError } = await client
        .from("request_locations")
        .select("latitude,longitude,accuracy_meters,address_text,captured_at,confirmed_at")
        .eq("request_id", request.id)
        .maybeSingle();
      if (locationError) throw ApiError.internal("Unable to load the caller's emergency location.", locationError.message);

      const coordinates = validCoordinates(location?.latitude, location?.longitude);
      return {
        callerRole: caller.role,
        trackingMode: "request_location",
        location: coordinates ? {
          ...coordinates,
          accuracyMeters: location?.accuracy_meters == null ? null : Number(location.accuracy_meters),
          address: location?.address_text ?? null,
          capturedAt: location?.captured_at ?? location?.confirmed_at ?? null,
        } : null,
      };
    }

    const { data: assignment, error: assignmentError } = await client
      .from("request_assignments")
      .select("id")
      .eq("request_id", request.id)
      .eq("responder_user_id", caller.id)
      .in("status", ACTIVE_ASSIGNMENT_STATUSES)
      .maybeSingle();
    if (assignmentError) throw ApiError.internal("Unable to verify the responder's active assignment.", assignmentError.message);
    if (!assignment) throw ApiError.notFound("The caller is no longer assigned to this request.");

    const { data: profile, error: profileError } = await client
      .from("responder_profiles")
      .select("current_latitude,current_longitude,location_accuracy_meters,last_location_at")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (profileError) throw ApiError.internal("Unable to load the responder's current location.", profileError.message);

    const coordinates = validCoordinates(profile?.current_latitude, profile?.current_longitude);
    return {
      callerRole: caller.role,
      trackingMode: "live_responder",
      location: coordinates ? {
        ...coordinates,
        accuracyMeters: profile?.location_accuracy_meters == null ? null : Number(profile.location_accuracy_meters),
        address: null,
        capturedAt: profile?.last_location_at ?? null,
      } : null,
    };
  },
);

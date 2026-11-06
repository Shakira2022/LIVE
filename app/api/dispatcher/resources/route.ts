import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { getOrganisationMapCenter, type MapCenter } from "@/lib/middleware/server/organisation-map-center";

export const runtime = "nodejs";

const ACTIVE_ASSIGNMENT_STATUSES = ["assigned", "acknowledged", "en_route", "arrived"];
const OPEN_REQUEST_STATUSES = ["submitted", "received", "assigned", "en_route", "arrived"];

export const GET = createHandler(
  {
    name: "dispatcher.resources",
    auth: "required",
    roles: ["dispatcher", "admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const organisationId = ctx.user.role === "dispatcher" ? ctx.user.organisationId : null;
    if (ctx.user.role === "dispatcher" && !organisationId) {
      return { responders: [], busyResponderIds: [], teams: [], organisations: [] };
    }

    const client = db();
    let responderQuery = client
      .from("responder_profiles")
      .select("user_id,organisation_id,availability,current_latitude,current_longitude,last_location_at,employee_number");
    let teamQuery = client
      .from("responder_teams")
      .select("id,organisation_id,name,code,description,status")
      .eq("status", "available")
      .order("name", { ascending: true });
    let organisationQuery = client
      .from("organisations")
      .select("id,name,organisation_type,status,latitude,longitude,city,suburb,province")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (organisationId) {
      responderQuery = responderQuery.eq("organisation_id", organisationId);
      teamQuery = teamQuery.eq("organisation_id", organisationId);
      organisationQuery = organisationQuery.eq("id", organisationId);
    }

    const [profileResult, teamResult, organisationResult] = await Promise.all([
      responderQuery,
      teamQuery,
      organisationQuery,
    ]);
    if (profileResult.error) {
      throw ApiError.internal("Unable to retrieve organisation responders.", profileResult.error.message);
    }
    if (teamResult.error) {
      throw ApiError.internal("Unable to retrieve responder teams.", teamResult.error.message);
    }
    if (organisationResult.error) {
      throw ApiError.internal("Unable to retrieve organisation details.", organisationResult.error.message);
    }

    const profiles = profileResult.data ?? [];
    const userIds = profiles.map((profile) => profile.user_id);
    const { data: users, error: usersError } = userIds.length
      ? await client
          .from("users")
          .select("id,first_name,last_name,display_name,phone")
          .in("id", userIds)
          .eq("role", "responder")
          .eq("status", "active")
          .is("deleted_at", null)
      : { data: [], error: null };
    if (usersError) {
      throw ApiError.internal("Unable to retrieve organisation responder accounts.", usersError.message);
    }

    const activeUserIds = new Set((users ?? []).map((user) => user.id));
    const responders = profiles
      .filter((profile) => activeUserIds.has(profile.user_id))
      .map((profile) => ({
        ...profile,
        user: (users ?? []).find((user) => user.id === profile.user_id) ?? null,
      }));
    const responderIds = responders.map((profile) => profile.user_id);

    let assignmentQuery = client
      .from("request_assignments")
      .select("request_id,responder_user_id,organisation_id")
      .not("responder_user_id", "is", null)
      .in("status", ACTIVE_ASSIGNMENT_STATUSES);
    if (organisationId) assignmentQuery = assignmentQuery.eq("organisation_id", organisationId);
    if (responderIds.length) assignmentQuery = assignmentQuery.in("responder_user_id", responderIds);
    else assignmentQuery = assignmentQuery.eq("responder_user_id", "00000000-0000-0000-0000-000000000000");

    const { data: assignments, error: assignmentsError } = await assignmentQuery;
    if (assignmentsError) {
      throw ApiError.internal("Unable to verify responder assignments.", assignmentsError.message);
    }

    const requestIds = [...new Set((assignments ?? []).map((assignment) => assignment.request_id))];
    const { data: activeRequests, error: requestsError } = requestIds.length
      ? await client
          .from("emergency_requests")
          .select("id,current_status")
          .in("id", requestIds)
          .in("current_status", OPEN_REQUEST_STATUSES)
      : { data: [], error: null };
    if (requestsError) {
      throw ApiError.internal("Unable to verify active responder requests.", requestsError.message);
    }

    const activeRequestIds = new Set((activeRequests ?? []).map((request) => request.id));
    const activeRequestByResponder = Object.fromEntries(
      (assignments ?? [])
        .filter((assignment) => activeRequestIds.has(assignment.request_id) && assignment.responder_user_id)
        .map((assignment) => [String(assignment.responder_user_id), assignment.request_id] as const),
    );
    const busyResponderIds = [...new Set(
      (assignments ?? [])
        .filter((assignment) => activeRequestIds.has(assignment.request_id))
        .map((assignment) => assignment.responder_user_id)
        .filter((id): id is string => Boolean(id)),
    )];
    let mapCenter: MapCenter | null = null;
    if (organisationId) {
      try {
        mapCenter = await getOrganisationMapCenter(organisationId);
      } catch (error) {
        throw ApiError.internal(
          "Unable to determine the organisation map area.",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      responders,
      busyResponderIds,
      activeRequestByResponder,
      teams: teamResult.data ?? [],
      organisations: organisationResult.data ?? [],
      mapCenter,
    };
  },
);

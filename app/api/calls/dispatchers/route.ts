import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { rankOrganisationsByDistance } from "@/lib/middleware/server/routing-service";

export const runtime = "nodejs";

const querySchema = z.object({ requestId: z.string().uuid().optional() });

type DispatcherCandidate = { id: string; name: string; organisationName: string };

export const GET = createHandler(
  {
    name: "calls.dispatchers.list",
    auth: "required",
    roles: ["requester", "responder", "dispatcher"],
    query: querySchema,
    rateLimit: { limit: 30, windowMs: 60_000, by: "user" },
  },
  async (ctx) => {
    const client = db();

    if (ctx.user.role === "dispatcher") {
      const organisationId = ctx.user.organisationId;
      if (!organisationId) return { candidates: [] as DispatcherCandidate[] };

      const { data: memberships, error: membershipError } = await client
        .from("organisation_members")
        .select("user_id,organisation_id")
        .eq("organisation_id", organisationId)
        .eq("status", "active");
      if (membershipError) throw ApiError.internal("Unable to find dispatch colleagues.", membershipError.message);

      const colleagueIds = [...new Set((memberships ?? []).map((row) => row.user_id).filter((id) => id !== ctx.user.userId))];
      if (!colleagueIds.length) return { candidates: [] as DispatcherCandidate[] };

      const [{ data: users, error: usersError }, { data: organisation, error: organisationError }] = await Promise.all([
        client.from("users")
          .select("id,first_name,last_name,display_name")
          .in("id", colleagueIds)
          .eq("role", "dispatcher")
          .eq("status", "active")
          .is("deleted_at", null),
        client.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
      ]);
      if (usersError) throw ApiError.internal("Unable to load dispatch colleagues.", usersError.message);
      if (organisationError) throw ApiError.internal("Unable to load the dispatch area.", organisationError.message);

      const candidates = (users ?? []).map((user) => ({
        id: user.id,
        name: user.display_name?.trim() || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Dispatcher",
        organisationName: organisation?.name ?? "Dispatch",
      }));
      return { candidates };
    }

    if (!ctx.query.requestId) throw new ApiError("BAD_REQUEST", "An active request is required to call dispatch.");

    const { data: request, error: requestError } = await client
      .from("emergency_requests")
      .select("id,requester_id,routed_organisation_id,current_status")
      .eq("id", ctx.query.requestId)
      .maybeSingle();
    if (requestError) throw ApiError.internal("Unable to load the emergency location.", requestError.message);
    if (!request) throw ApiError.notFound();

    if (ctx.user.role === "requester" && request.requester_id !== ctx.user.userId) throw ApiError.notFound();
    if (ctx.user.role === "responder") {
      const { data: assignment, error: assignmentError } = await client
        .from("request_assignments")
        .select("id")
        .eq("request_id", request.id)
        .eq("responder_user_id", ctx.user.userId)
        .in("status", ["assigned", "acknowledged", "en_route", "arrived"])
        .maybeSingle();
      if (assignmentError) throw ApiError.internal("Unable to verify your mission assignment.", assignmentError.message);
      if (!assignment) throw ApiError.notFound();
    }
    if (!["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"].includes(String(request.current_status).toLowerCase())) {
      throw new ApiError("BAD_REQUEST", "Dispatch calls are available only for an active emergency.");
    }

    const { data: location, error: locationError } = await client
      .from("request_locations")
      .select("latitude,longitude")
      .eq("request_id", request.id)
      .maybeSingle();
    if (locationError) throw ApiError.internal("Unable to load the emergency location.", locationError.message);

    const latitude = location?.latitude == null ? Number.NaN : Number(location.latitude);
    const longitude = location?.longitude == null ? Number.NaN : Number(location.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
    const rankedOrganisations = hasCoordinates
      ? await rankOrganisationsByDistance({ latitude, longitude }, { withinMetres: Number.POSITIVE_INFINITY })
      : [];
    const organisationIds = [...new Set([
      ...(request.routed_organisation_id ? [request.routed_organisation_id] : []),
      ...rankedOrganisations.map((organisation) => organisation.id),
    ])];
    if (!organisationIds.length) return { candidates: [] as DispatcherCandidate[] };

    const [{ data: memberships, error: membershipError }, { data: organisations, error: organisationsError }] = await Promise.all([
      client.from("organisation_members")
        .select("user_id,organisation_id")
        .in("organisation_id", organisationIds)
        .eq("status", "active"),
      client.from("organisations")
        .select("id,name")
        .in("id", organisationIds)
        .eq("status", "active"),
    ]);
    if (membershipError) throw ApiError.internal("Unable to find local dispatchers.", membershipError.message);
    if (organisationsError) throw ApiError.internal("Unable to load dispatch areas.", organisationsError.message);

    const memberIds = [...new Set((memberships ?? []).map((row) => row.user_id))];
    if (!memberIds.length) return { candidates: [] as DispatcherCandidate[] };

    const { data: users, error: usersError } = await client.from("users")
      .select("id,first_name,last_name,display_name")
      .in("id", memberIds)
      .eq("role", "dispatcher")
      .eq("status", "active")
      .is("deleted_at", null);
    if (usersError) throw ApiError.internal("Unable to load local dispatchers.", usersError.message);

    const userById = new Map((users ?? []).map((user) => [user.id, user] as const));
    const organisationNameById = new Map((organisations ?? []).map((organisation) => [organisation.id, organisation.name] as const));
    const candidates: DispatcherCandidate[] = [];
    const included = new Set<string>();
    for (const organisationId of organisationIds) {
      const organisationName = organisationNameById.get(organisationId);
      if (!organisationName) continue;
      for (const membership of memberships ?? []) {
        if (membership.organisation_id !== organisationId || included.has(membership.user_id)) continue;
        const user = userById.get(membership.user_id);
        if (!user) continue;
        included.add(user.id);
        candidates.push({
          id: user.id,
          name: user.display_name?.trim() || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Dispatcher",
          organisationName,
        });
      }
    }

    return { candidates };
  },
);

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.users",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const client = db();
    const { data, error } = await client
      .from("users")
      .select("id,email,phone,role,status,first_name,last_name,display_name,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw ApiError.internal("Unable to retrieve users.", error.message);
    }

    const userIds = (data ?? []).map((user) => user.id);
    const [{ data: responderProfiles, error: responderError }, { data: memberships, error: membershipError }, { data: organisations, error: organisationError }] = await Promise.all([
      userIds.length
        ? client.from("responder_profiles").select("user_id,organisation_id").in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? client.from("organisation_members").select("user_id,organisation_id,organisations(name)").in("user_id", userIds).eq("status", "active")
        : Promise.resolve({ data: [], error: null }),
      client.from("organisations").select("id,name,status").order("name", { ascending: true }),
    ]);

    if (responderError || membershipError || organisationError) {
      throw ApiError.internal("Unable to retrieve user organisations.", responderError?.message ?? membershipError?.message ?? organisationError?.message);
    }

    const responderOrganisationByUser = new Map((responderProfiles ?? []).map((profile) => [profile.user_id, profile.organisation_id]));
    const membershipByUser = new Map((memberships ?? []).map((membership) => {
      const related = membership.organisations as unknown as { name: string } | { name: string }[] | null;
      const organisation = Array.isArray(related) ? related[0] : related;
      return [membership.user_id, { id: membership.organisation_id, name: organisation?.name ?? null }];
    }));
    const organisationNames = new Map((organisations ?? []).map((organisation) => [organisation.id, organisation.name]));
    const users = (data ?? []).map((user) => {
      const responderOrganisationId = responderOrganisationByUser.get(user.id);
      const membership = membershipByUser.get(user.id);
      const effectiveOrganisationId = user.role === "requester"
        ? null
        : user.role === "responder"
          ? responderOrganisationId ?? membership?.id ?? null
          : membership?.id ?? null;
      return {
        ...user,
        organisation_id: effectiveOrganisationId,
        organisation_name: effectiveOrganisationId ? organisationNames.get(effectiveOrganisationId) ?? membership?.name ?? null : null,
      };
    });

    return { users, organisations: organisations ?? [] };
  },
);

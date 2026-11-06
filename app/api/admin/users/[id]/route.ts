import { z } from "zod";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";
import { sendSupportEmail } from "@/lib/support-email";
import { notifyAdminsOfUserEvent } from "@/lib/notifications/admin-user-events";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

function getApplicationOrigin(request: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

const bodySchema = z
  .object({
    role: z
      .enum(["requester", "dispatcher", "responder", "admin", "auditor", "manager"])
      .optional(),
    status: z
      .enum(["pending", "active", "suspended", "locked", "deactivated"])
      .optional(),
    organisationId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined || value.organisationId !== undefined, {
    message: "No valid changes were supplied.",
  });

export const PATCH = createHandler(
  {
    name: "admin.user.update",
    auth: "required",
    roles: ["admin"],
    params: paramsSchema,
    body: bodySchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: "user" },
    audit: {
      action: "admin_user_updated",
      targetType: "user",
    },
  },
  async (ctx) => {
    if (ctx.user.userId === ctx.params.id) {
      throw new ApiError(
        "BAD_REQUEST",
        "You cannot modify your own role or account status.",
      );
    }

    const client = db();
    const { data: currentUser, error: currentUserError } = await client
      .from("users")
      .select("id,role,status")
      .eq("id", ctx.params.id)
      .is("deleted_at", null)
      .single();

    if (currentUserError || !currentUser) {
      throw ApiError.notFound("User not found.");
    }

    const nextRole = ctx.body.role ?? currentUser.role;
    if (nextRole === "requester" && ctx.body.organisationId) {
      throw new ApiError("BAD_REQUEST", "Requester accounts cannot belong to an organisation.");
    }

    if (ctx.body.organisationId) {
      const { data: organisation, error: organisationError } = await client
        .from("organisations")
        .select("id")
        .eq("id", ctx.body.organisationId)
        .maybeSingle();
      if (organisationError || !organisation) {
        throw new ApiError("BAD_REQUEST", "Choose a valid organisation.");
      }
    }

    const { data: currentProfile } = await client
      .from("responder_profiles")
      .select("organisation_id,availability")
      .eq("user_id", ctx.params.id)
      .maybeSingle();
    const { data: currentMembership } = await client
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", ctx.params.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const targetOrganisationId = ctx.body.organisationId ?? currentProfile?.organisation_id ?? currentMembership?.organisation_id ?? null;
    const organisationChanged = Boolean(
      ctx.body.organisationId && currentProfile?.organisation_id !== ctx.body.organisationId,
    );

    if ((organisationChanged || (currentUser.role === "responder" && nextRole !== "responder")) && currentUser.role === "responder") {
      const { count, error: assignmentError } = await client
        .from("request_assignments")
        .select("id", { count: "exact", head: true })
        .eq("responder_user_id", ctx.params.id)
        .in("status", ["assigned", "acknowledged", "en_route", "arrived"]);
      if (assignmentError) {
        throw ApiError.internal("Unable to verify the responder's active assignments.", assignmentError.message);
      }
      if ((count ?? 0) > 0) {
        throw new ApiError("CONFLICT", "This responder has an active assignment. Complete or release it before changing organisations.");
      }
    }

    const updates = {
      ...(ctx.body.role !== undefined ? { role: ctx.body.role } : {}),
      ...(ctx.body.status !== undefined ? { status: ctx.body.status } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data: userData, error } = await client
      .from("users")
      .update(updates)
      .eq("id", ctx.params.id)
      .is("deleted_at", null)
      .select("id,email,phone,role,status,first_name,last_name,display_name,created_at")
      .single();

    if (error) {
      throw ApiError.internal("Unable to update the user.", error.message);
    }

    const suspensionChanged = currentUser.status !== userData.status &&
      (userData.status === "suspended" || (currentUser.status === "suspended" && userData.status === "active"));
    let statusEmailSent = false;
    let statusEmailStatus: "not_required" | "sent" | "failed" | "missing_email" = "not_required";
    if (suspensionChanged && !userData.email) {
      statusEmailStatus = "missing_email";
    } else if (suspensionChanged && userData.email) {
      const recipientName = userData.display_name?.trim() ||
        [userData.first_name, userData.last_name].filter(Boolean).join(" ").trim() ||
        "LIVE user";
      const suspended = userData.status === "suspended";
      const subject = suspended
        ? "Your LIVE account has been suspended"
        : "Your LIVE account is active again";
      const supportUrl = `${getApplicationOrigin(ctx.req)}/support`;
      const message = suspended
        ? `Hello ${recipientName},\n\nAn administrator has suspended your LIVE account. While the suspension is in place, you cannot sign in or use your account.\n\nIf you believe this is a mistake or need help understanding what to do next, contact LIVE Support: ${supportUrl}\n\nLIVE Support`
        : `Hello ${recipientName},\n\nAn administrator has lifted the suspension on your LIVE account. Your account is active again, and you can sign in with your usual credentials.\n\nIf you need help signing in, contact LIVE Support: ${supportUrl}\n\nLIVE Support`;
      const htmlMessage = suspended
        ? `<div style="font-family:Arial,sans-serif;color:#102b3f;line-height:1.6"><p>Hello ${escapeHtml(recipientName)},</p><p>An administrator has suspended your LIVE account. While the suspension is in place, you cannot sign in or use your account.</p><p>If you believe this is a mistake or need help understanding what to do next, contact <a href="${escapeHtml(supportUrl)}">LIVE Support</a>.</p><p>LIVE Support</p></div>`
        : `<div style="font-family:Arial,sans-serif;color:#102b3f;line-height:1.6"><p>Hello ${escapeHtml(recipientName)},</p><p>An administrator has lifted the suspension on your LIVE account. Your account is active again, and you can sign in with your usual credentials.</p><p>If you need help signing in, contact <a href="${escapeHtml(supportUrl)}">LIVE Support</a>.</p><p>LIVE Support</p></div>`;

      try {
        await sendSupportEmail(userData.email, subject, message, htmlMessage);
        statusEmailSent = true;
        statusEmailStatus = "sent";
      } catch (emailError) {
        statusEmailStatus = "failed";
        ctx.log.error("admin_user_status_email_failed", {
          cause: emailError instanceof Error ? emailError.message : String(emailError),
          userId: ctx.params.id,
          status: userData.status,
        });
      }
    }

    if (nextRole === "responder" && targetOrganisationId) {
      const profilePatch: Record<string, unknown> = {
        user_id: ctx.params.id,
        organisation_id: targetOrganisationId,
        updated_at: new Date().toISOString(),
      };
      if (!currentProfile) profilePatch.availability = "offline";
      if (organisationChanged) {
        profilePatch.availability = "offline";
        profilePatch.current_latitude = null;
        profilePatch.current_longitude = null;
        profilePatch.location_accuracy_meters = null;
        profilePatch.last_location_at = null;
      }
      const { error: profileError } = await client
        .from("responder_profiles")
        .upsert(profilePatch, { onConflict: "user_id" });
      if (profileError) {
        throw ApiError.internal("The user was updated, but their responder organisation could not be saved.", profileError.message);
      }
    } else if (currentUser.role === "responder" && nextRole !== "responder") {
      const { error: profileError } = await client
        .from("responder_profiles")
        .update({ availability: "offline", updated_at: new Date().toISOString() })
        .eq("user_id", ctx.params.id);
      if (profileError) {
        throw ApiError.internal("The user was updated, but their responder profile could not be set offline.", profileError.message);
      }
    }

    if (nextRole === "requester") {
      const { error: membershipError } = await client
        .from("organisation_members")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("user_id", ctx.params.id)
        .eq("status", "active");
      if (membershipError) {
        throw ApiError.internal("The user was updated, but their organisation membership could not be removed.", membershipError.message);
      }
    } else if (targetOrganisationId) {
      const { data: activeMemberships, error: membershipsError } = await client
        .from("organisation_members")
        .select("id")
        .eq("user_id", ctx.params.id)
        .eq("status", "active")
        .order("joined_at", { ascending: true });
      if (membershipsError) {
        throw ApiError.internal("The user was updated, but their organisation membership could not be loaded.", membershipsError.message);
      }
      const membershipIds = (activeMemberships ?? []).map((membership) => membership.id);
      if (membershipIds.length) {
        const { error: membershipUpdateError } = await client
          .from("organisation_members")
          .update({ organisation_id: targetOrganisationId, updated_at: new Date().toISOString() })
          .in("id", membershipIds);
        if (membershipUpdateError) {
          throw ApiError.internal("The user was updated, but their organisation membership could not be saved.", membershipUpdateError.message);
        }
      } else {
        const { error: membershipInsertError } = await client
          .from("organisation_members")
          .insert({
            organisation_id: targetOrganisationId,
            user_id: ctx.params.id,
            operational_role: nextRole,
            status: "active",
          });
        if (membershipInsertError) {
          throw ApiError.internal("The user was updated, but their organisation membership could not be created.", membershipInsertError.message);
        }
      }
    }

    const organisationId = nextRole === "requester" ? null : targetOrganisationId;
    const { data: organisation } = organisationId
      ? await client.from("organisations").select("name").eq("id", organisationId).maybeSingle()
      : { data: null };
    const data = { ...userData, organisation_id: organisationId, organisation_name: organisation?.name ?? null };

    const roleChanged = currentUser.role !== userData.role;
    const statusChanged = currentUser.status !== userData.status;
    if (roleChanged || statusChanged || organisationChanged) {
      const changedFields = [
        roleChanged ? `role changed to ${userData.role}` : null,
        statusChanged ? `account status changed to ${userData.status}` : null,
        organisationChanged ? `organisation changed to ${organisation?.name ?? "another organisation"}` : null,
      ].filter(Boolean);
      const affectedUserName = userData.display_name?.trim() || [userData.first_name, userData.last_name].filter(Boolean).join(" ").trim() || userData.email || "A user";
      await notifyAdminsOfUserEvent({
        notificationType: "admin_user_updated",
        title: "User account updated",
        message: `${affectedUserName}: ${changedFields.join("; ")}.`,
      });
    }

    ctx.audit({
      targetId: ctx.params.id,
      changedRole: ctx.body.role ?? null,
      changedStatus: ctx.body.status ?? null,
      changedOrganisationId: ctx.body.organisationId ?? null,
      statusEmailSent,
    });

    return { user: data, statusEmailStatus };
  },
);

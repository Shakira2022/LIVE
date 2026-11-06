"use client";

import { LoaderCircle, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import type { UserRole } from "@/lib/types";
import { readCached, writeFreshCache } from "@/lib/client-cache";

interface AdminUser {
  id: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  created_at: string;
  organisation_id?: string | null;
  organisation_name?: string | null;
}

interface AdminOrganisation { id: string; name: string; status?: string }
type AddableRole = Exclude<UserRole, "admin">;
type NewUserForm = { firstName: string; lastName: string; email: string; phone: string; role: AddableRole; organisationId: string };
const EMPTY_NEW_USER: NewUserForm = { firstName: "", lastName: "", email: "", phone: "", role: "requester", organisationId: "" };


type AdminUsersResponse = {
  ok?: boolean;
  data?: {
    users?: AdminUser[];
    user?: AdminUser;
    organisations?: AdminOrganisation[];
    credentialsEmailStatus?: "sent";
  };
  users?: AdminUser[];
  user?: AdminUser;
  organisations?: AdminOrganisation[];
  message?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

function getApiMessage(
  result: AdminUsersResponse | null,
  fallback: string,
) {
  if (!result) return fallback;

  if (typeof result.error === "string") {
    return result.error;
  }

  if (
    result.error &&
    typeof result.error === "object"
  ) {
    return (
      result.error.message ||
      result.message ||
      fallback
    );
  }

  return result.message || fallback;
}

async function readJson<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response = await fetch(
    input,
    requestInit,
  );

  if (response.status !== 401) {
    return response;
  }

  const refreshResponse = await fetch(
    "/api/auth/refresh",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!refreshResponse.ok) {
    return response;
  }

  return fetch(
    input,
    requestInit,
  );
}


export default function AdminUsers() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const usersCacheKey = user?.id ? `admin-users:${user.id}` : null;
  const cachedUsers = usersCacheKey ? readCached<{ users: AdminUser[]; organisations: AdminOrganisation[] }>(usersCacheKey) : null;
  const [users, setUsers] = useState<AdminUser[]>(() => cachedUsers?.users ?? []);
  const [loading, setLoading] = useState(() => !cachedUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [organisationFilter, setOrganisationFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ message: string; failed: boolean } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [organisations, setOrganisations] = useState<AdminOrganisation[]>(() => cachedUsers?.organisations ?? []);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER);

  const loadUsers =
    useCallback(async () => {
      if (!user?.id) {
        setUsers([]);
        setLoading(false);
        return;
      }

      try {
        if (!usersCacheKey || !readCached(usersCacheKey)) setLoading(true);
        setError("");

        const response =
          await authenticatedFetch(
            "/api/admin/users",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<AdminUsersResponse>(
            response,
          );

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setUsers([]);
          setError(
            getApiMessage(
              result,
              "Unable to load users.",
            ),
          );
          return;
        }

        const nextUsers =
          result?.data?.users ??
          result?.users ??
          [];

        setUsers(
          Array.isArray(nextUsers)
            ? nextUsers
            : [],
        );
        setOrganisations(result?.data?.organisations ?? result?.organisations ?? []);
        if (usersCacheKey) writeFreshCache(usersCacheKey, { users: Array.isArray(nextUsers) ? nextUsers : [], organisations: result?.data?.organisations ?? result?.organisations ?? [] }, 5 * 60_000);
      } catch {
        setUsers([]);
        setError(
          "Unable to connect to the admin users service.",
        );
      } finally {
        setLoading(false);
      }
    }, [
      refresh,
      usersCacheKey,
      user?.id,
    ]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user?.id) {
      setUsers([]);
      setLoading(false);
      return;
    }

    void loadUsers();
  }, [
    authLoading,
    loadUsers,
    user?.id,
  ]);

  async function updateUser(
    id: string,
    changes: {
      role?: UserRole;
      status?: string;
      organisationId?: string | null;
    },
  ) {
    try {
      setBusyUserId(id);
      setError("");

      const response =
        await authenticatedFetch(
          `/api/admin/users/${id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(changes),
          },
        );

      const result =
        await readJson<AdminUsersResponse>(
          response,
        );

      if (!response.ok) {
        if (response.status === 401) {
          await refresh();
        }

        setError(
          getApiMessage(
            result,
            "Unable to update the user.",
          ),
        );
        return;
      }

      const updatedUser =
        result?.data?.user ??
        result?.user ??
        null;

      if (!updatedUser) {
        setError(
          "The user was updated, but the server did not return the updated record.",
        );
        return;
      }

      setUsers((current) =>
        current.map((item) =>
          item.id === id
            ? updatedUser
            : item,
        ),
      );
      if (usersCacheKey) {
        const current = readCached<{ users: AdminUser[]; organisations: AdminOrganisation[] }>(usersCacheKey) ?? { users, organisations };
        writeFreshCache(usersCacheKey, { ...current, users: current.users.map((item) => item.id === id ? updatedUser : item) }, 5 * 60_000);
      }
    } catch {
      setError("Unable to connect to the admin user service.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingUser(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/users/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: newUser.firstName, lastName: newUser.lastName, email: newUser.email,
          phone: newUser.phone, role: newUser.role,
          organisationId: newUser.organisationId || null,
        }),
      });
      const result = await readJson<AdminUsersResponse>(response);
      if (!response.ok) {
        if (response.status === 401) await refresh();
        setError(getApiMessage(result, "Unable to create the user account."));
        return;
      }
      setAddUserOpen(false);
      setNewUser(EMPTY_NEW_USER);
      setNotice({ message: "Account created as pending. The user must verify their email before signing in; the verification link and temporary password were emailed directly to them.", failed: false });
      await loadUsers();
    } catch {
      setError("Unable to connect to the admin user service.");
    } finally {
      setCreatingUser(false);
    }
  }

  const organisationRequired = ["dispatcher", "responder", "manager"].includes(newUser.role);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((item) => {
      if (roleFilter !== "All" && item.role !== roleFilter) return false;
      if (statusFilter !== "All" && item.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (organisationFilter === "None" && item.organisation_id) return false;
      if (organisationFilter !== "All" && organisationFilter !== "None" && item.organisation_id !== organisationFilter) return false;
      if (!term) return true;
      const name =
        item.display_name ||
        [item.first_name, item.last_name]
          .filter(Boolean)
          .join(" ");

      return `${name} ${item.email} ${item.role} ${item.organisation_name ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [users, search, roleFilter, statusFilter, organisationFilter]);

  if (authLoading || loading || !user) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="Users and roles"
        description="Search users, manage roles and suspend or restore account access."
        action={<Button onClick={() => setAddUserOpen(true)}><Plus className="h-4 w-4" />Add user</Button>}
      />

      {error ? (
        <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
          {error}
        </div>
      ) : null}
      {notice ? <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.failed ? "border-[#f0d8a8] bg-[#fff7e8] text-[#865b12]" : "border-[#b9e4d4] bg-[#edf9f4] text-[#176b50]"}`}>{notice.message}</div> : null}

      <Panel>
        <div className="border-b border-[#e2e8ed] p-4 sm:p-5">
          <div className="relative max-w-xl">
            <Search className="absolute left-3.5 top-3.5 h-5 w-5 text-[#8b9aa4]" />

            <Input
              className="pl-11"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users"
            />
          </div>
        </div>

        <PanelHeader title={`${items.length} users`} action={<div className="grid w-40 gap-2 sm:w-auto sm:grid-cols-2 lg:grid-cols-3">
          <Select className="h-10 w-full sm:w-40" aria-label="Filter users by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="All">All statuses</option>{[...new Set(users.map((item) => item.status))].sort().map((status) => <option key={status} value={status}>{status}</option>)}</Select>
          <Select className="h-10 w-full sm:w-40" aria-label="Filter users by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="All">All roles</option><option value="requester">Requester</option><option value="dispatcher">Dispatcher</option><option value="responder">Responder</option><option value="admin">Administrator</option><option value="auditor">Auditor</option><option value="manager">Operations manager</option><option value="support">Support (legacy)</option></Select>
          <Select className="h-10 w-full sm:w-56" aria-label="Filter users by organisation" value={organisationFilter} onChange={(event) => setOrganisationFilter(event.target.value)}><option value="All">All organisations</option><option value="None">No organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</Select>
        </div>} />

        <div role="region" aria-label="User list" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto p-3 md:hidden">
          {items.map((item) => {
            const name =
              item.display_name ||
              [item.first_name, item.last_name]
                .filter(Boolean)
                .join(" ") ||
              item.email;

            const initials = name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("");

            const isActive = item.status.toLowerCase() === "active";
            const isSelf = item.id === user.id;

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-[#dfe7ec] p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#102b3f] text-xs font-bold text-white">
                    {initials || "U"}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{name}</h2>
                    <p className="truncate text-xs text-[#71828d]">
                      {item.email}
                    </p>
                  </div>

                  <Badge tone={isActive ? "success" : "danger"}>
                    {item.status}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <Select
                    value={item.role}
                    disabled={isSelf || busyUserId === item.id}
                    onChange={(event) =>
                      updateUser(item.id, {
                        role: event.target.value as UserRole,
                      })
                    }
                  >
                    <option value="requester">Requester</option>
                    <option value="dispatcher">Dispatcher</option>
                    <option value="responder">Responder</option>
                    <option value="admin">Administrator</option>
                <option value="auditor">Auditor</option>
                <option value="manager">Operations manager</option>
                    {String(item.role) === "support" ? <option value="support" disabled>Support (legacy)</option> : null}
                  </Select>

                  <Button
                    variant="outline"
                    disabled={isSelf || busyUserId === item.id}
                    onClick={() =>
                      updateUser(item.id, {
                        status: isActive ? "suspended" : "active",
                      })
                    }
                  >
                    {isActive ? "Suspend" : "Restore"}
                  </Button>
                </div>
                {item.role !== "requester" ? <Select className="mt-2 h-10 w-full" aria-label={`Organisation for ${name}`} value={item.organisation_id ?? ""} disabled={isSelf || busyUserId === item.id} onChange={(event) => updateUser(item.id, { organisationId: event.target.value || null })}><option value="">Select organisation</option>{organisations.filter((organisation) => organisation.status === "active").map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</Select> : null}
              </article>
            );
          })}
        </div>

        <div role="region" aria-label="User table" tabIndex={0} className="hidden max-h-[65vh] touch-pan-y overscroll-contain overflow-auto md:block">
                  <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-y border-[#e2e8ed] bg-[#f7f9fa] text-xs uppercase tracking-wide text-[#70838f]">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#e2e8ed]">
              {items.map((item) => {
                const name =
                  item.display_name ||
                  [item.first_name, item.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                  item.email;

                const initials = name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("");

                const isActive =
                  item.status.toLowerCase() === "active";

                const isSelf = item.id === user.id;

                return (
                  <tr key={item.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#102b3f] text-[10px] font-bold text-white">
                          {initials || "U"}
                        </span>

                        <div>
                          <p className="font-semibold">{name}</p>
                          <p className="text-xs text-[#71828d]">
                            {item.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <Select
                        className="h-10 min-w-40"
                        value={item.role}
                        disabled={isSelf || busyUserId === item.id}
                        onChange={(event) =>
                          updateUser(item.id, {
                            role: event.target.value as UserRole,
                          })
                        }
                      >
                        <option value="requester">Requester</option>
                        <option value="dispatcher">Dispatcher</option>
                        <option value="responder">Responder</option>
                        <option value="admin">Administrator</option>
                        <option value="auditor">Auditor</option>
                        <option value="manager">Operations manager</option>
                        {String(item.role) === "support" ? <option value="support" disabled>Support (legacy)</option> : null}
                      </Select>
                    </td>

                    <td className="px-5 py-4">
                      {item.role === "requester" ? <span className="text-[#8b9aa4]">—</span> : <Select className="h-10 min-w-48" aria-label={`Organisation for ${name}`} value={item.organisation_id ?? ""} disabled={isSelf || busyUserId === item.id} onChange={(event) => updateUser(item.id, { organisationId: event.target.value || null })}>
                        <option value="">Select organisation</option>
                        {organisations.filter((organisation) => organisation.status === "active").map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
                      </Select>}
                    </td>

                    <td className="px-5 py-4"><Badge tone={isActive ? "success" : "danger"}>{item.status}</Badge></td>

                    <td className="px-5 py-4">
                      {item.phone || "—"}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSelf || busyUserId === item.id}
                        onClick={() =>
                          updateUser(item.id, {
                            status: isActive
                              ? "suspended"
                              : "active",
                          })
                        }
                      >
                        {busyUserId === item.id
                          ? "Updating..."
                          : isActive
                            ? "Suspend"
                            : "Restore"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Sheet open={addUserOpen} onOpenChange={setAddUserOpen} title="Add user" description="Create an account. LIVE will email the user their sign-in details." side="center" className="max-w-2xl" footer={<div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={creatingUser} onClick={() => setAddUserOpen(false)}>Cancel</Button><Button type="submit" form="admin-create-user-form" disabled={creatingUser}>{creatingUser ? <><LoaderCircle className="h-4 w-4 animate-spin" />Creating...</> : "Create user"}</Button></div>}>
        <form id="admin-create-user-form" className="grid gap-5 px-5 py-5 sm:px-6" onSubmit={createUser}>
          <p className="rounded-xl bg-[#f2f7f8] px-4 py-3 text-sm leading-5 text-[#607583]">A temporary password and email verification link are sent only to the user. They must verify their email before signing in. You will not see the password.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">First name<Input required autoComplete="given-name" value={newUser.firstName} onChange={(e) => setNewUser((v) => ({ ...v, firstName: e.target.value }))} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Last name<Input required autoComplete="family-name" value={newUser.lastName} onChange={(e) => setNewUser((v) => ({ ...v, lastName: e.target.value }))} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Email address<Input required type="email" autoComplete="email" value={newUser.email} onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Phone number <span className="text-xs font-normal text-[#82929c]">Enter 10 digits starting with 0</span><Input required type="tel" inputMode="numeric" pattern="0[0-9]{9}" maxLength={10} value={newUser.phone} onChange={(e) => setNewUser((v) => ({ ...v, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Role<Select value={newUser.role} onChange={(e) => setNewUser((v) => ({ ...v, role: e.target.value as AddableRole, organisationId: e.target.value === "requester" ? "" : v.organisationId }))}><option value="requester">Requester</option><option value="dispatcher">Dispatcher</option><option value="responder">Responder</option><option value="auditor">Auditor</option><option value="manager">Operations manager</option></Select></label>
            {newUser.role !== "requester" ? <label className="grid gap-1.5 text-sm font-medium">Organisation{organisationRequired ? " *" : ""}<Select required={organisationRequired} value={newUser.organisationId} onChange={(e) => setNewUser((v) => ({ ...v, organisationId: e.target.value }))}><option value="">{organisationRequired ? "Select an organisation" : "No organisation"}</option>{organisations.filter((o) => o.status === "active").map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></label> : null}
          </div>
        </form>
      </Sheet>
    </div>
  );
}

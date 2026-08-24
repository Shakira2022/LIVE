"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/lib/types";

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
}


type AdminUsersResponse = {
  ok?: boolean;
  data?: {
    users?: AdminUser[];
    user?: AdminUser;
  };
  users?: AdminUser[];
  user?: AdminUser;
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

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadUsers =
    useCallback(async () => {
      if (!user?.id) {
        setUsers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
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
    } catch {
      setError("Unable to connect to the admin user service.");
    } finally {
      setBusyUserId(null);
    }
  }

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return users;

    return users.filter((item) => {
      const name =
        item.display_name ||
        [item.first_name, item.last_name]
          .filter(Boolean)
          .join(" ");

      return `${name} ${item.email} ${item.role}`
        .toLowerCase()
        .includes(term);
    });
  }, [users, search]);

  if (authLoading || loading || !user) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="Users and roles"
        description="Search users, manage roles and suspend or restore account access."
      />

      {error ? (
        <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
          {error}
        </div>
      ) : null}

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

        <PanelHeader title={`${items.length} users`} />

        <div className="grid gap-3 p-3 md:hidden">
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
                    <option value="support">Support</option>
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
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-y border-[#e2e8ed] bg-[#f7f9fa] text-xs uppercase tracking-wide text-[#70838f]">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Role</th>
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
                        <option value="support">Support</option>
                      </Select>
                    </td>

                    <td className="px-5 py-4">
                      <Badge tone={isActive ? "success" : "danger"}>
                        {item.status}
                      </Badge>
                    </td>

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
    </div>
  );
}

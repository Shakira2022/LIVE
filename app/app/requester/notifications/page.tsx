"use client";

import {
  Bell,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/utils";

interface Notification {
  id: string;
  recipient_user_id: string;
  request_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  sensitivity: string;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
}

type ApiErrorShape = {
  code?: string;
  message?: string;
  details?: Record<string, string[]>;
};

type NotificationListResponse = {
  ok?: boolean;
  data?:
    | Notification[]
    | {
        notifications?: Notification[];
        items?: Notification[];
      };
  notifications?: Notification[];
  items?: Notification[];
  message?: string;
  error?: string | ApiErrorShape;
};

type NotificationUpdateResponse = {
  ok?: boolean;
  data?:
    | Notification
    | {
        notification?: Notification;
      };
  notification?: Notification;
  message?: string;
  error?: string | ApiErrorShape;
};

function getApiMessage(
  payload:
    | NotificationListResponse
    | NotificationUpdateResponse
    | null,
  fallback: string,
) {
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error === "object"
  ) {
    const firstDetail =
      payload.error.details
        ? Object.values(
            payload.error.details,
          )
            .flat()
            .find(Boolean)
        : undefined;

    return (
      firstDetail ||
      payload.error.message ||
      payload.message ||
      fallback
    );
  }

  return payload.message || fallback;
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

/*
 * The authenticated middleware uses the httpOnly access-token cookie.
 *
 * If the access token has expired but the refresh cookie is still valid,
 * refresh once and retry the original request. This prevents a page from
 * showing "Authentication is required" while AuthProvider still has the
 * previously authenticated user in memory.
 */
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

  const refreshResponse =
    await fetch(
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

  response = await fetch(
    input,
    requestInit,
  );

  return response;
}

function extractNotifications(
  result: NotificationListResponse | null,
): Notification[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result.data)) {
    return result.data;
  }

  if (
    result.data &&
    !Array.isArray(result.data)
  ) {
    const nested =
      result.data.notifications ??
      result.data.items;

    if (Array.isArray(nested)) {
      return nested;
    }
  }

  if (Array.isArray(result.notifications)) {
    return result.notifications;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  return [];
}

function extractUpdatedNotification(
  result: NotificationUpdateResponse | null,
): Notification | null {
  if (!result) {
    return null;
  }

  if (
    result.data &&
    typeof result.data === "object" &&
    "id" in result.data
  ) {
    return result.data as Notification;
  }

  if (
    result.data &&
    typeof result.data === "object" &&
    "notification" in result.data
  ) {
    return (
      result.data.notification ??
      null
    );
  }

  return result.notification ?? null;
}

export default function Notifications() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const [notifications, setNotifications] =
    useState<Notification[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [markingAll, setMarkingAll] =
    useState(false);

  const fetchNotifications =
    useCallback(async () => {
      if (!user?.id) {
        setNotifications([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const response =
          await authenticatedFetch(
            "/api/notifications",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<NotificationListResponse>(
            response,
          );

        if (!response.ok) {
          /*
           * If refresh also failed, synchronise AuthProvider with the
           * server instead of throwing an expected 401 into the Next.js
           * development error overlay.
           */
          if (response.status === 401) {
            await refresh();
            setNotifications([]);
            return;
          }

          throw new Error(
            getApiMessage(
              result,
              "Unable to retrieve notifications.",
            ),
          );
        }

        setNotifications(
          extractNotifications(result),
        );
      } catch (error) {
        /*
         * Do not use console.error here. In Next.js development mode a
         * caught client error logged with console.error is surfaced as the
         * large red development overlay even though the page recovered.
         */
        console.warn(
          "Unable to load notifications:",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setNotifications([]);
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
      setNotifications([]);
      setLoading(false);
      return;
    }

    void fetchNotifications();
  }, [
    authLoading,
    user?.id,
    fetchNotifications,
  ]);

  async function markNotificationRead(
    notificationId: string,
  ) {
    try {
      const response =
        await authenticatedFetch(
          `/api/notifications/${notificationId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              read: true,
            }),
          },
        );

      const result =
        await readJson<NotificationUpdateResponse>(
          response,
        );

      if (!response.ok) {
        if (response.status === 401) {
          await refresh();
          return;
        }

        throw new Error(
          getApiMessage(
            result,
            "Unable to mark notification as read.",
          ),
        );
      }

      const updated =
        extractUpdatedNotification(
          result,
        );

      setNotifications((current) =>
        current.map(
          (notification) =>
            notification.id ===
            notificationId
              ? {
                  ...notification,
                  ...(updated ?? {}),
                  read_at:
                    updated?.read_at ??
                    new Date().toISOString(),
                }
              : notification,
        ),
      );
    } catch (error) {
      console.warn(
        "Unable to mark notification as read:",
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  async function markAllNotificationsRead() {
    const unreadNotifications =
      notifications.filter(
        (notification) =>
          notification.read_at === null,
      );

    if (!unreadNotifications.length) {
      return;
    }

    try {
      setMarkingAll(true);

      await Promise.all(
        unreadNotifications.map(
          (notification) =>
            markNotificationRead(
              notification.id,
            ),
        ),
      );
    } finally {
      setMarkingAll(false);
    }
  }

  if (
    authLoading ||
    loading ||
    !user
  ) {
    return <PageSkeleton />;
  }

  const unread = notifications.filter(
    (notification) =>
      notification.read_at === null,
  ).length;

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Requester"
        title="Notifications"
        description="Request confirmations and lifecycle updates."
      />

      <Panel
        mobileCard={false}
        className="-mx-5 border-x-0 md:mx-0 md:rounded-[22px] md:border-x"
      >
        <PanelHeader
          title={`${unread} unread`}
          className="items-center px-5"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !unread || markingAll
              }
              onClick={
                markAllNotificationsRead
              }
            >
              <CheckCheck className="h-4 w-4" />

              {markingAll
                ? "Marking..."
                : "Mark all read"}
            </Button>
          }
        />

        {notifications.length ? (
          <div className="divide-y divide-[#e2e8ed]">
            {notifications.map(
              (notification) => {
                const isUnread =
                  notification.read_at ===
                  null;

                return (
                  <article
                    key={notification.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer px-5 py-4 outline-none transition focus-visible:bg-[#edf5f6] md:px-5 md:py-5 ${
                      isUnread
                        ? "bg-[#f2f9f9]"
                        : "bg-transparent md:bg-white"
                    }`}
                    onClick={() => {
                      if (isUnread) {
                        markNotificationRead(
                          notification.id,
                        );
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        (
                          event.key ===
                            "Enter" ||
                          event.key === " "
                        ) &&
                        isUnread
                      ) {
                        event.preventDefault();

                        markNotificationRead(
                          notification.id,
                        );
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          isUnread
                            ? "bg-[#0f5b67]"
                            : "bg-[#ccd6dc]"
                        }`}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="font-semibold text-[#102b3f]">
                            {
                              notification.title
                            }
                          </h2>

                          <span className="shrink-0 text-xs text-[#7a8a95]">
                            {timeAgo(
                              notification.created_at,
                            )}
                          </span>
                        </div>

                        <p className="mt-2 text-sm leading-6 text-[#5d7382]">
                          {
                            notification.message
                          }
                        </p>

                        {notification.request_id ? (
                          <Link
                            href={`/app/requester/track/${notification.request_id}`}
                            className="mt-3 inline-block text-sm font-semibold text-[#0f5b67]"
                            onClick={(
                              event,
                            ) => {
                              event.stopPropagation();

                              if (
                                isUnread
                              ) {
                                markNotificationRead(
                                  notification.id,
                                );
                              }
                            }}
                          >
                            Open request
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              },
            )}
          </div>
        ) : (
          <EmptyState
            icon={
              <Bell className="h-6 w-6" />
            }
            title="No notifications"
            description="Status updates will appear here."
          />
        )}
      </Panel>
    </div>
  );
}
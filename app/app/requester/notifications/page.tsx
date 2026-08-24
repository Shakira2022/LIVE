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

export default function Notifications() {
  const { user, loading: authLoading } = useAuth();

  const [notifications, setNotifications] = useState<
    Notification[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      const response = await fetch(
        "/api/notifications",
        {
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ||
            "Unable to retrieve notifications.",
        );
      }

      setNotifications(
        result.notifications ?? [],
      );
    } catch (error) {
      console.error(
        "Unable to load notifications:",
        error,
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!authLoading && user?.id) {
      fetchNotifications();
    }
  }, [
    authLoading,
    user?.id,
    fetchNotifications,
  ]);

  async function markNotificationRead(
    notificationId: string,
  ) {
    try {
      const response = await fetch(
        `/api/notifications/${notificationId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            read: true,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ||
            "Unable to mark notification as read.",
        );
      }

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                read_at:
                  result.notification?.read_at ??
                  new Date().toISOString(),
              }
            : notification,
        ),
      );
    } catch (error) {
      console.error(
        "Unable to mark notification as read:",
        error,
      );
    }
  }

  async function markAllNotificationsRead() {
    const unreadNotifications =
      notifications.filter(
        (notification) =>
          notification.read_at === null,
      );

    if (!unreadNotifications.length) return;

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
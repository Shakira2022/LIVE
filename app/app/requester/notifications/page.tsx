"use client";

import {
  Bell,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import { timeAgo } from "@/lib/utils";

export default function Notifications() {
  const { user } = useAuth();
  const {
    db,
    loading,
    markNotificationRead,
    markAllNotificationsRead,
  } = useMockStore();

  if (loading || !db || !user) {
    return <PageSkeleton />;
  }

  const items = db.notifications.filter(
    (notification) => notification.userId === user.id,
  );
  const unread = items.filter(
    (notification) => !notification.read,
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
              disabled={!unread}
              onClick={() =>
                markAllNotificationsRead(user.id)
              }
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          }
        />

        {items.length ? (
          <div className="divide-y divide-[#e2e8ed]">
            {items.map((notification) => (
              <article
                key={notification.id}
                role="button"
                tabIndex={0}
                className={`cursor-pointer px-5 py-4 outline-none transition focus-visible:bg-[#edf5f6] md:px-5 md:py-5 ${
                  notification.read
                    ? "bg-transparent md:bg-white"
                    : "bg-[#f2f9f9]"
                }`}
                onClick={() =>
                  markNotificationRead(notification.id)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" ||
                    event.key === " "
                  ) {
                    event.preventDefault();
                    markNotificationRead(notification.id);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      notification.read
                        ? "bg-[#ccd6dc]"
                        : "bg-[#0f5b67]"
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-[#102b3f]">
                        {notification.title}
                      </h2>
                      <span className="shrink-0 text-xs text-[#7a8a95]">
                        {timeAgo(notification.createdAt)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm leading-6 text-[#5d7382]">
                      {notification.message}
                    </p>

                    {notification.requestId ? (
                      <Link
                        href={`/app/requester/track/${notification.requestId}`}
                        className="mt-3 inline-block text-sm font-semibold text-[#0f5b67]"
                        onClick={(event) =>
                          event.stopPropagation()
                        }
                      >
                        Open request
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="No notifications"
            description="Status updates will appear here."
          />
        )}
      </Panel>
    </div>
  );
}

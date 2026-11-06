"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, CircleAlert, CircleCheck, Flag, PhoneMissed } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { CallDetailsSheet } from "@/components/calls/call-details-sheet";
import { RequestDetailsSheet } from "@/components/requests/request-details-sheet";
import { authenticatedFetch } from "@/lib/client-api";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

type Notification = {
  id: string;
  recipient_user_id: string;
  request_id: string | null;
  call_id: string | null;
  responder_report_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  sensitivity: string;
  created_at: string;
  read_at: string | null;
};

type NotificationResponse = {
  data?: { notifications?: Notification[] };
  notifications?: Notification[];
  error?: { message?: string };
};

function iconForNotification(type: string) {
  if (type === "missed_call") return PhoneMissed;
  if (type === "cancellation_requested" || type === "request_cancelled_by_dispatcher") return CircleAlert;
  if (type === "request_completed" || type === "request_cancelled") return CircleCheck;
  if (type === "responder_report_submitted") return Flag;
  if (type === "responder_report_resolved") return CircleCheck;
  return Bell;
}

export default function DispatcherNotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading, refresh } = useAuth();
  const cacheKey = user?.id ? `dispatcher-notifications:${user.id}` : "";
  const cached = user?.id ? readCached<Notification[]>(cacheKey) : null;
  const [notifications, setNotifications] = useState<Notification[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [markingAll, setMarkingAll] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const fetchInFlight = useRef(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id || document.visibilityState === "hidden" || fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const response = await authenticatedFetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) await refresh();
        return;
      }
      const payload = await response.json() as NotificationResponse;
      const nextNotifications = payload.data?.notifications ?? payload.notifications ?? [];
      setNotifications(nextNotifications);
      writeFreshCache(cacheKey, nextNotifications, 5 * 60_000);
    } catch (error) {
      console.warn("Unable to load dispatcher notifications:", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [cacheKey, refresh, user?.id]);

  useEffect(() => {
    if (authLoading || !user) return;
    void fetchNotifications();
    const timer = window.setInterval(() => void fetchNotifications(), 5_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchNotifications();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authLoading, fetchNotifications, user]);

  const markRead = useCallback(async (notificationId: string) => {
    try {
      const response = await authenticatedFetch(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ read: true }),
      });
      if (!response.ok) {
        if (response.status === 401) await refresh();
        return false;
      }
      setNotifications((current) => {
        const next = current.map((item) => item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item);
        if (cacheKey) writeFreshCache(cacheKey, next, 5 * 60_000);
        return next;
      });
      return true;
    } catch (error) {
      console.warn("Unable to mark dispatcher notification as read:", error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [cacheKey, refresh]);

  async function markAllRead() {
    const unread = notifications.filter((item) => !item.read_at);
    if (!unread.length) return;
    setMarkingAll(true);
    try {
      await Promise.all(unread.map((item) => markRead(item.id)));
    } finally {
      setMarkingAll(false);
    }
  }

  function openNotification(notification: Notification) {
    if (!notification.read_at) void markRead(notification.id);
    if (notification.call_id) setSelectedCallId(notification.call_id);
    else if (notification.request_id) setSelectedRequestId(notification.request_id);
    else if (notification.responder_report_id) router.push("/app/dispatcher/resources");
  }

  if (authLoading || !user) return <PageSkeleton />;

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return (
    <div className="app-page grid gap-5">
      <PageHeading title="Notifications" description="Calls, cancellation requests, responder reports, and other updates for your organisation." />
      <Panel mobileCard={false} className={notifications.length === 0 ? "!border-b-0 !bg-transparent md:!rounded-[22px] md:!border-b md:!bg-white" : "border-0 bg-white md:rounded-[22px]"}>
        {loading ? <p className="p-5 text-sm text-[#667b89]">Loading notifications...</p> : <>
          <PanelHeader
            title={`${unreadCount} unread`}
            description="New notifications are checked automatically while this page is open."
            descriptionClassName="hidden sm:block"
            className="items-center border-b-0 px-4 py-3"
            action={<Button variant="ghost" size="sm" disabled={!unreadCount || markingAll} onClick={() => void markAllRead()}><CheckCheck className="h-4 w-4" />{markingAll ? "Marking..." : "Mark all read"}</Button>}
          />
          {notifications.length ? (
            <div className="max-h-[70vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
              {notifications.map((notification) => {
                const isUnread = !notification.read_at;
                const Icon = iconForNotification(notification.notification_type);
                return (
                  <article
                    key={notification.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer px-4 py-3 outline-none transition focus-visible:bg-[#edf5f6] md:px-5 md:py-4 ${isUnread ? "bg-[#f2f9f9]" : "bg-white"}`}
                    onClick={() => openNotification(notification)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openNotification(notification);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${isUnread ? "bg-[#e7f3f4] text-[#0f6872]" : "bg-[#f2f6f8] text-[#788a96]"}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="font-semibold text-[#102b3f]">{notification.title}</h2>
                          <span className="shrink-0 text-xs text-[#7a8a95]">{timeAgo(notification.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[#5d7382]">{notification.message}</p>
                        {notification.call_id ? (
                          <button type="button" className="mt-2 inline-block text-xs font-semibold text-[#0f5b67]" onClick={(event) => { event.stopPropagation(); if (isUnread) void markRead(notification.id); setSelectedCallId(notification.call_id); }}>View call details</button>
                        ) : null}
                        {notification.request_id && !notification.call_id ? (
                          <button type="button" className="mt-2 ml-3 inline-block text-xs font-semibold text-[#0f5b67]" onClick={(event) => { event.stopPropagation(); if (isUnread) void markRead(notification.id); setSelectedRequestId(notification.request_id); }}>View request</button>
                        ) : null}
                        {notification.responder_report_id ? (
                          <button type="button" className="mt-2 ml-3 inline-block text-xs font-semibold text-[#0f5b67]" onClick={(event) => { event.stopPropagation(); if (isUnread) void markRead(notification.id); router.push("/app/dispatcher/resources"); }}>View responder status</button>
                        ) : null}
                        {isUnread ? <span className="mt-2 ml-3 inline-block h-2 w-2 rounded-full bg-[#0f5b67] align-middle" aria-label="Unread" /> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Call, cancellation, report, and completion updates will appear here." />
          )}
        </>}
      </Panel>
      <RequestDetailsSheet
        requestId={selectedRequestId}
        open={Boolean(selectedRequestId)}
        onOpenChange={(open) => { if (!open) setSelectedRequestId(null); }}
      />
      <CallDetailsSheet
        callId={selectedCallId}
        open={Boolean(selectedCallId)}
        onOpenChange={(open) => { if (!open) setSelectedCallId(null); }}
      />
    </div>
  );
}

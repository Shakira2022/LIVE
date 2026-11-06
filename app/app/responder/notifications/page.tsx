"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeading } from "@/components/ui/page-heading";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { PageSkeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/utils";
import { RequestDetailsSheet } from "@/components/requests/request-details-sheet";
import { CallDetailsSheet } from "@/components/calls/call-details-sheet";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type Notification = {
  id: string;
  title: string;
  message: string;
  request_id: string | null;
  call_id: string | null;
  created_at: string;
  read_at: string | null;
};

type ApiResponse = {
  ok?: boolean;
  data?: { notifications?: Notification[] };
  notifications?: Notification[];
  message?: string;
};

async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const requestInit: RequestInit = { ...init, credentials: "include" };
  let response = await fetch(input, requestInit);
  if (response.status !== 401) return response;

  const refreshResponse = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  if (!refreshResponse.ok) return response;
  return fetch(input, requestInit);
}

export default function ResponderNotificationsPage() {
  const { user, loading: authLoading, refresh } = useAuth();
  const cacheKey = user?.id ? `responder-notifications:${user.id}` : "";
  const [notifications, setNotifications] = useState<Notification[]>(() => user?.id ? readCached<Notification[]>(`responder-notifications:${user.id}`) ?? [] : []);
  const [loading, setLoading] = useState(() => !user?.id || !readCached<Notification[]>(`responder-notifications:${user.id}`));
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await authenticatedFetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) await refresh();
        return;
      }
      const payload = await response.json() as ApiResponse;
      const nextNotifications = payload.data?.notifications ?? payload.notifications ?? [];
      setNotifications(nextNotifications);
      if (cacheKey) writeFreshCache(cacheKey, nextNotifications, 5 * 60_000);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, refresh, user?.id]);

  useEffect(() => {
    if (authLoading || !user) return;
    void fetchNotifications();
    const timer = window.setInterval(() => void fetchNotifications(), 5_000);
    return () => window.clearInterval(timer);
  }, [authLoading, fetchNotifications, user]);

  async function markRead(notificationId: string) {
    await fetch(`/api/notifications/${notificationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item));
  }

  async function markAllRead() {
    const unread = notifications.filter((item) => !item.read_at);
    await Promise.all(unread.map((item) => markRead(item.id)));
  }

  if (authLoading || !user) return <PageSkeleton />;

  return (
    <div className="app-page grid gap-5">
      <PageHeading title="Notifications" description="Important updates about assignments, calls and response activity." />
      <Panel mobileCard={false} className={notifications.length === 0 ? "!border-b-0 !bg-transparent md:!rounded-[22px] md:!border-b md:!bg-white" : "border-0 bg-white md:rounded-[22px]"}>
        {loading ? <p className="p-5 text-sm text-[#667b89]">Loading notifications...</p> : <>
          <PanelHeader
            title={`${notifications.filter((item) => !item.read_at).length} unread`}
            description="Notifications about assignments, calls and response activity remain here for reference."
            descriptionClassName="hidden sm:block"
            className="items-center border-b-0 px-4 py-3"
            action={<Button variant="ghost" size="sm" disabled={!notifications.some((item) => !item.read_at)} onClick={() => void markAllRead()}><CheckCheck className="h-4 w-4" /> Mark all read</Button>}
          />
          {notifications.length ? <div className="max-h-[60vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">{notifications.map((notification) => {
            const isUnread = !notification.read_at;
            return <article key={notification.id} role="button" tabIndex={0} className={`cursor-pointer px-4 py-3 outline-none transition focus-visible:bg-[#edf5f6] md:px-4 md:py-4 ${isUnread ? "bg-[#f2f9f9]" : "bg-transparent md:bg-white"}`} onClick={() => { if (isUnread) void markRead(notification.id); if (notification.call_id) setSelectedCallId(notification.call_id); else if (notification.request_id) setSelectedRequestId(notification.request_id); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (isUnread) void markRead(notification.id); if (notification.call_id) setSelectedCallId(notification.call_id); else if (notification.request_id) setSelectedRequestId(notification.request_id); } }}>
              <div className="flex items-start gap-3"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${isUnread ? "bg-[#0f5b67]" : "bg-[#ccd6dc]"}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-[#102b3f]">{notification.title}</h2><span className="shrink-0 text-xs text-[#7a8a95]">{timeAgo(notification.created_at)}</span></div><p className="mt-2 text-sm leading-6 text-[#5d7382]">{notification.message}</p></div></div>
              {(notification.call_id || notification.request_id) ? <button type="button" className="mt-3 inline-block text-sm font-semibold text-[#0f5b67]" onClick={(event) => { event.stopPropagation(); if (isUnread) void markRead(notification.id); if (notification.call_id) setSelectedCallId(notification.call_id); else if (notification.request_id) setSelectedRequestId(notification.request_id); }}>{notification.call_id ? "View call details" : "View mission details"}</button> : null}
            </article>;
          })}</div> : <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Assignment and call updates will appear here." />}
        </>}
      </Panel>
      <RequestDetailsSheet
        requestId={selectedRequestId}
        open={Boolean(selectedRequestId)}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
      />
      <CallDetailsSheet
        callId={selectedCallId}
        open={Boolean(selectedCallId)}
        onOpenChange={(open) => {
          if (!open) setSelectedCallId(null);
        }}
      />
    </div>
  );
}

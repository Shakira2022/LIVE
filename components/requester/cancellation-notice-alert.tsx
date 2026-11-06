"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { authenticatedFetch } from "@/lib/client-api";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { readRequesterPreferences } from "@/lib/requester-preferences";

type CancellationNotification = {
  id: string;
  request_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  read_at: string | null;
};

type NotificationsPayload = {
  data?: { notifications?: CancellationNotification[] };
  notifications?: CancellationNotification[];
};

export function RequesterCancellationNoticeAlert({ userId }: { userId: string }) {
  const router = useRouter();
  const uiLanguage = useRequesterLanguage(userId);
  const [notification, setNotification] = useState<CancellationNotification | null>(null);
  const checkInFlight = useRef(false);
  const handledNotificationIds = useRef(new Set<string>());
  const activeNotificationRef = useRef<CancellationNotification | null>(null);

  useEffect(() => {
    let stopped = false;

    const markRead = async (notificationId: string) => {
      try {
        await authenticatedFetch(`/api/notifications/${notificationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ read: true }),
        });
      } catch {
        // The notification remains recorded even if this read update fails.
      }
    };

    const checkForCancellation = async () => {
      if (!userId || stopped || document.visibilityState === "hidden" || checkInFlight.current || activeNotificationRef.current) return;
      checkInFlight.current = true;
      try {
        const response = await authenticatedFetch("/api/notifications", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as NotificationsPayload;
        const notifications = payload.data?.notifications ?? payload.notifications ?? [];
        const nextNotification = notifications.find((item) =>
          item.notification_type === "request_cancelled" &&
          item.request_id &&
          !item.read_at &&
          !handledNotificationIds.current.has(item.id),
        );

        if (!nextNotification || stopped) return;
        handledNotificationIds.current.add(nextNotification.id);
        activeNotificationRef.current = nextNotification;
        setNotification(nextNotification);
        if (readRequesterPreferences(userId).blindVoiceGuidance) {
          window.dispatchEvent(new CustomEvent("live:blind-announcement", {
            detail: {
              notificationId: nextNotification.id,
              text: `${requesterText(uiLanguage, nextNotification.title)}. ${requesterText(uiLanguage, nextNotification.message)}`,
            },
          }));
        }
        void markRead(nextNotification.id);
      } catch (error) {
        console.warn("Unable to load requester cancellation notification:", error instanceof Error ? error.message : String(error));
      } finally {
        checkInFlight.current = false;
      }
    };

    void checkForCancellation();
    const timer = window.setInterval(() => void checkForCancellation(), 5_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForCancellation();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [uiLanguage, userId]);

  function closeAlert() {
    activeNotificationRef.current = null;
    setNotification(null);
  }

  function viewRequest() {
    if (!notification?.request_id) return;
    const requestId = notification.request_id;
    closeAlert();
    router.push(`/app/requester/track/${encodeURIComponent(requestId)}`);
  }

  return (
    <Sheet
      open={Boolean(notification)}
      onOpenChange={(open) => { if (!open) closeAlert(); }}
      title={requesterText(uiLanguage, "Request cancelled")}
      description={notification?.message}
      side="center"
    >
      {notification ? (
        <div className="grid gap-4 px-5 py-4 sm:px-6">
          <div className="rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-4">
            <p className="flex items-center gap-2 font-semibold text-[#27684e]">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              {requesterText(uiLanguage, "Your emergency request has been successfully cancelled.")}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#536f63]">
              {requesterText(uiLanguage, "If you still need help, submit a new request or contact emergency services.")}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeAlert}>
              {requesterText(uiLanguage, "Close")}
            </Button>
            <Button type="button" onClick={viewRequest}>
              {requesterText(uiLanguage, "View request")}
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

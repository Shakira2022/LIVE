"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, PhoneCall } from "lucide-react";

import { useCall } from "@/components/calls/call-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { authenticatedFetch } from "@/lib/client-api";

type CancellationNotification = {
  id: string;
  request_id: string | null;
  notification_type: string;
  read_at: string | null;
};

type CancellationAlert = {
  notificationId: string;
  requestId: string;
  reference: string;
  dispatcherUserId: string | null;
};

type NotificationsPayload = {
  data?: { notifications?: CancellationNotification[] };
  notifications?: CancellationNotification[];
};

type RequestDetailPayload = {
  reference?: string;
  history?: Array<{
    newStatus?: string;
    actorRole?: string | null;
    changedByUserId?: string | null;
    new_status?: string;
    actor_role?: string | null;
    changed_by_user_id?: string | null;
  }>;
};

type RequestPayload = {
  data?: RequestDetailPayload;
  request?: RequestDetailPayload;
};

export function ResponderCancellationApprovedAlert({ userId }: { userId: string }) {
  const { call, startCall } = useCall();
  const [alert, setAlert] = useState<CancellationAlert | null>(null);
  const [loadingDispatcher, setLoadingDispatcher] = useState(false);
  const [callError, setCallError] = useState("");
  const checkInFlight = useRef(false);
  const handledNotificationIds = useRef(new Set<string>());
  const activeAlertRef = useRef<CancellationAlert | null>(null);

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
        // Keep the pop-up usable if marking it read is temporarily unavailable.
      }
    };

    const checkForCancellation = async () => {
      if (!userId || stopped || document.visibilityState === "hidden" || checkInFlight.current || activeAlertRef.current) return;
      checkInFlight.current = true;
      try {
        const notificationsResponse = await authenticatedFetch("/api/notifications", { cache: "no-store" });
        if (!notificationsResponse.ok) return;
        const notificationsPayload = await notificationsResponse.json() as NotificationsPayload;
        const notifications = notificationsPayload.data?.notifications ?? notificationsPayload.notifications ?? [];
        const notification = notifications.find((item) =>
          item.notification_type === "request_cancelled_by_dispatcher" &&
          item.request_id &&
          !item.read_at &&
          !handledNotificationIds.current.has(item.id),
        );
        const requestId = notification?.request_id;
        if (!notification || !requestId) return;

        const requestResponse = await authenticatedFetch(`/api/requests/${encodeURIComponent(requestId)}`, { cache: "no-store" });
        if (!requestResponse.ok) return;
        const requestPayload = await requestResponse.json() as RequestPayload;
        const request = requestPayload.data ?? requestPayload.request;
        const history = request?.history ?? [];
        const approval = [...history].reverse().find((entry) => {
          const newStatus = String(entry.newStatus ?? entry.new_status ?? "").toLowerCase();
          const actorRole = String(entry.actorRole ?? entry.actor_role ?? "").toLowerCase();
          return newStatus === "cancelled" && (actorRole === "dispatcher" || actorRole === "admin");
        });
        const nextAlert: CancellationAlert = {
          notificationId: notification.id,
          requestId,
          reference: request?.reference ?? notification.request_id ?? requestId,
          dispatcherUserId: approval?.changedByUserId ?? approval?.changed_by_user_id ?? null,
        };
        if (stopped) return;
        handledNotificationIds.current.add(notification.id);
        activeAlertRef.current = nextAlert;
        setAlert(nextAlert);
        void markRead(notification.id);
      } catch (error) {
        console.warn("Unable to load responder cancellation notification:", error instanceof Error ? error.message : String(error));
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
  }, [userId]);

  function closeAlert() {
    activeAlertRef.current = null;
    setAlert(null);
  }

  async function callApprovingDispatcher() {
    if (!alert?.dispatcherUserId) return;
    const currentAlert = alert;
    const dispatcherUserId = currentAlert.dispatcherUserId;
    if (!dispatcherUserId) return;
    setLoadingDispatcher(true);
    setCallError("");
    try {
      await startCall(`dispatcher:${dispatcherUserId}`, "Dispatcher", {
        targetRole: "dispatcher",
        targetUserId: dispatcherUserId,
        requestId: currentAlert.requestId,
      });
      closeAlert();
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Unable to call the dispatcher.");
    } finally {
      setLoadingDispatcher(false);
    }
  }

  return (
    <Sheet
      open={Boolean(alert)}
      onOpenChange={(open) => { if (!open && !loadingDispatcher) closeAlert(); }}
      title="Request cancellation approved"
      description={alert ? `Request ${alert.reference} was cancelled by dispatch.` : undefined}
      side="center"
      dismissible={!loadingDispatcher}
    >
      {alert ? (
        <div className="grid gap-4 px-5 py-4 sm:px-6">
          <div className="rounded-xl border border-[#cde8dd] bg-[#eff9f4] p-4">
            <p className="flex items-center gap-2 font-semibold text-[#27684e]"><CheckCircle2 className="h-5 w-5 shrink-0" />The requester cancelled this mission, and dispatch approved the cancellation.</p>
            <p className="mt-2 text-sm leading-6 text-[#536f63]">Do not continue to the request location. Contact the dispatcher who approved the cancellation if you need clarification.</p>
          </div>
          {callError ? <p role="alert" className="rounded-xl border border-[#efcdca] bg-[#fff6f5] p-3 text-sm text-[#a9443d]">{callError}</p> : null}
          <Button
            type="button"
            disabled={!alert.dispatcherUserId || loadingDispatcher || call.status !== "idle"}
            onClick={() => void callApprovingDispatcher()}
          >
            {loadingDispatcher ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
            {loadingDispatcher ? "Calling dispatcher..." : "Call dispatcher"}
          </Button>
          {!alert.dispatcherUserId ? <p role="alert" className="text-sm text-[#a9443d]">Dispatcher details are not available for this cancellation.</p> : null}
          <Button type="button" variant="outline" disabled={loadingDispatcher} onClick={closeAlert}>Close</Button>
        </div>
      ) : null}
    </Sheet>
  );
}

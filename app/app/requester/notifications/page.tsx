"use client";

import {
  Bell,
  CheckCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { requesterText, requesterTimeAgo, useRequesterLanguage } from "@/lib/requester-ui";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageSkeleton } from "@/components/ui/skeleton";
import { PageHeading } from "@/components/ui/page-heading";
import { RequestDetailsSheet } from "@/components/requests/request-details-sheet";
import { CallDetailsSheet } from "@/components/calls/call-details-sheet";
import { RequesterPageHelpButton } from "@/components/requester/requester-page-help-button";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import type { RequesterLanguage } from "@/lib/requester-language";

interface Notification {
  id: string;
  recipient_user_id: string;
  request_id: string | null;
  call_id?: string | null;
  notification_type: string;
  title: string;
  message: string;
  sensitivity: string;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
}

const SPEECH_LANGUAGE_TAG: Record<RequesterLanguage, string> = {
  English: "en-ZA", Afrikaans: "af-ZA", isiZulu: "zu-ZA", isiXhosa: "xh-ZA", Sesotho: "st-ZA",
  Setswana: "tn-ZA", Sepedi: "nso-ZA", siSwati: "ss-ZA", Tshivenda: "ve-ZA", isiNdebele: "nr-ZA", XiTsonga: "ts-ZA",
};

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
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const [blindVoiceGuidance, setBlindVoiceGuidance] = useState(() => readRequesterPreferences(user?.id).blindVoiceGuidance);
  const speechQueueRef = useRef<Notification[]>([]);
  const queuedNotificationIdsRef = useRef(new Set<string>());
  const speakingRef = useRef(false);
  const manualReadingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const manualReadGenerationRef = useRef(0);
  const speakNextRef = useRef<() => void>(() => {});
  const pendingOpenUnreadRequestRef = useRef(false);
  const pendingOpenNotificationRef = useRef(false);
  const pendingReadNotificationsRef = useRef(false);

  const [notifications, setNotifications] =
    useState<Notification[]>(() =>
      user?.id
        ? readCached<Notification[]>(`requester-notifications:${user.id}`) ?? []
        : [],
    );

  const [loading, setLoading] =
    useState(false);

  const [markingAll, setMarkingAll] =
    useState(false);
  const [selectedRequestId, setSelectedRequestId] =
    useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const fetchNotifications =
    useCallback(async (forceRefresh = false) => {
      if (!user?.id) {
        setNotifications([]);
        setLoading(false);
        return;
      }

      const cacheKey = `requester-notifications:${user.id}`;
      const cached = readFreshCache<Notification[]>(cacheKey);
      if (cached && !forceRefresh) {
        setNotifications(cached);
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

        const nextNotifications = extractNotifications(result);
        setNotifications(nextNotifications);
        writeFreshCache(cacheKey, nextNotifications, 5 * 60_000);
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

    void fetchNotifications(true);
    const timer = window.setInterval(() => void fetchNotifications(true), 5_000);
    return () => window.clearInterval(timer);
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

      setNotifications((current) => {
        const nextNotifications = current.map(
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
        );
        if (user?.id) {
          writeFreshCache(`requester-notifications:${user.id}`, nextNotifications, 5 * 60_000);
        }
        return nextNotifications;
      });
    } catch (error) {
      console.warn(
        "Unable to mark notification as read:",
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  function readNotificationsAloud() {
    if (!("speechSynthesis" in window)) return;
    const generation = ++manualReadGenerationRef.current;
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    queuedNotificationIdsRef.current.clear();
    speakingRef.current = false;
    manualReadingRef.current = true;
    window.speechSynthesis.cancel();
    const unreadNotifications = notifications.filter((item) => item.read_at === null);
    const itemsToRead = unreadNotifications.length ? unreadNotifications : notifications;
    if (!itemsToRead.length) {
      const utterance = new SpeechSynthesisUtterance(requesterText(uiLanguage, "You have no notifications."));
      utterance.lang = SPEECH_LANGUAGE_TAG[uiLanguage];
      utterance.onend = () => { manualReadingRef.current = false; };
      utterance.onerror = () => { manualReadingRef.current = false; };
      window.speechSynthesis.speak(utterance);
      return;
    }
    let index = 0;
    const speakNext = () => {
      if (generation !== manualReadGenerationRef.current) return;
      const notification = itemsToRead[index];
      if (!notification) {
        manualReadingRef.current = false;
        return;
      }
      index += 1;
      const utterance = new SpeechSynthesisUtterance(`${requesterText(uiLanguage, notification.title)}. ${requesterText(uiLanguage, notification.message)}`);
      utterance.lang = SPEECH_LANGUAGE_TAG[uiLanguage];
      utterance.rate = 0.95;
      utterance.onend = () => {
        if (generation !== manualReadGenerationRef.current) return;
        if (notification.read_at === null) void markNotificationRead(notification.id);
        speakNext();
      };
      utterance.onerror = () => {
        if (generation === manualReadGenerationRef.current) speakNext();
      };
      window.speechSynthesis.speak(utterance);
    };
    speakNext();
  }

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (detail?.action === "close-notification-details") {
        setSelectedCallId(null);
        setSelectedRequestId(null);
        return;
      }
      if (detail?.action === "open-unread-request") pendingOpenUnreadRequestRef.current = true;
      else if (detail?.action === "open-notification") pendingOpenNotificationRef.current = true;
      else if (detail?.action === "read-notifications") pendingReadNotificationsRef.current = true;
      else return;
      void fetchNotifications(true);
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);

    if (window.sessionStorage.getItem("live-requester-voice-action-pending") === "open-unread-request") {
      window.sessionStorage.removeItem("live-requester-voice-action-pending");
      pendingOpenUnreadRequestRef.current = true;
      void fetchNotifications(true);
    } else if (window.sessionStorage.getItem("live-requester-voice-action-pending") === "open-notification") {
      window.sessionStorage.removeItem("live-requester-voice-action-pending");
      pendingOpenNotificationRef.current = true;
      void fetchNotifications(true);
    } else if (window.sessionStorage.getItem("live-requester-voice-action-pending") === "read-notifications") {
      window.sessionStorage.removeItem("live-requester-voice-action-pending");
      pendingReadNotificationsRef.current = true;
      void fetchNotifications(true);
    }

    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, [fetchNotifications]);

  useEffect(() => {
    if (loading) return;
    if (pendingOpenUnreadRequestRef.current) {
      pendingOpenUnreadRequestRef.current = false;
      const requestNotification = notifications.find((item) => item.read_at === null && Boolean(item.request_id));
      if (requestNotification?.request_id) {
        void markNotificationRead(requestNotification.id);
        setSelectedCallId(null);
        setSelectedRequestId(requestNotification.request_id);
      }
    }
    if (pendingOpenNotificationRef.current) {
      pendingOpenNotificationRef.current = false;
      const notification = notifications.find((item) => item.read_at === null) ?? notifications[0];
      if (notification) {
        if (notification.read_at === null) void markNotificationRead(notification.id);
        if (notification.call_id) {
          setSelectedRequestId(null);
          setSelectedCallId(notification.call_id);
        } else if (notification.request_id) {
          setSelectedCallId(null);
          setSelectedRequestId(notification.request_id);
        }
        else {
          const article = document.querySelector<HTMLElement>(`[data-live-notification-id="${CSS.escape(notification.id)}"]`);
          article?.scrollIntoView({ behavior: "smooth", block: "center" });
          article?.focus({ preventScroll: true });
        }
      }
    }
    if (pendingReadNotificationsRef.current) {
      pendingReadNotificationsRef.current = false;
      readNotificationsAloud();
    }
  }, [loading, markNotificationRead, notifications]);

  useEffect(() => {
    const sync = () => setBlindVoiceGuidance(readRequesterPreferences(user?.id).blindVoiceGuidance);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("live:requester-preferences-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:requester-preferences-changed", sync);
    };
  }, [user?.id]);

  speakNextRef.current = () => {
    if (!blindVoiceGuidance || speakingRef.current || !speechQueueRef.current.length || !("speechSynthesis" in window)) return;
    const notification = speechQueueRef.current.shift();
    if (!notification) return;
    const generation = speechGenerationRef.current;
    const title = requesterText(uiLanguage, notification.title);
    const message = requesterText(uiLanguage, notification.message).replace(/\s+/g, " ").trim();
    const briefMessage = message.length > 105 ? `${message.slice(0, 102).replace(/\s+\S*$/, "")}...` : message;
    const utterance = new SpeechSynthesisUtterance(`${title}. ${briefMessage}`);
    utterance.lang = SPEECH_LANGUAGE_TAG[uiLanguage];
    utterance.rate = 0.95;
    utterance.onend = () => {
      if (generation !== speechGenerationRef.current) return;
      speakingRef.current = false;
      void markNotificationRead(notification.id);
      window.setTimeout(() => speakNextRef.current(), 0);
    };
    utterance.onerror = () => {
      if (generation !== speechGenerationRef.current) return;
      speakingRef.current = false;
      window.setTimeout(() => speakNextRef.current(), 0);
    };
    speakingRef.current = true;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!blindVoiceGuidance) {
      speechGenerationRef.current += 1;
      speechQueueRef.current = [];
      queuedNotificationIdsRef.current.clear();
      speakingRef.current = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      return;
    }
    if (manualReadingRef.current) return;
    for (const notification of notifications) {
      if (!notification.read_at && !queuedNotificationIdsRef.current.has(notification.id)) {
        queuedNotificationIdsRef.current.add(notification.id);
        speechQueueRef.current.push(notification);
      }
    }
    speakNextRef.current();
  }, [blindVoiceGuidance, notifications]);

  useEffect(() => () => {
    manualReadGenerationRef.current += 1;
    manualReadingRef.current = false;
    speechGenerationRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

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
        title={requesterText(uiLanguage, "Notifications")}
        description={requesterText(uiLanguage, "Important updates about your emergency requests appear here.")}
        action={<RequesterPageHelpButton page="notifications" language={uiLanguage} />}
      />

      <Panel
        mobileCard={false}
        className={notifications.length === 0 ? "!border-b-0 !bg-transparent md:!rounded-[22px] md:!border-b md:!bg-white" : "border-0 bg-white md:rounded-[22px]"}
      >
        <PanelHeader
          title={requesterText(uiLanguage, "{count} unread", { count: unread })}
          description={requesterText(uiLanguage, "Notifications about request status and activity remain here for reference.")}
          descriptionClassName="hidden sm:block"
          className="items-center border-b-0 px-4 py-3"
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
                ? requesterText(uiLanguage, "Marking...")
                : requesterText(uiLanguage, "Mark all read")}
            </Button>
          }
        />

        {notifications.length ? (
          <div className="max-h-[60vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e2e8ed]">
            {notifications.map(
              (notification) => {
                const isUnread =
                  notification.read_at ===
                  null;

                return (
                  <article
                    key={notification.id}
                    data-live-voice-number={notifications.indexOf(notification) + 1}
                    data-live-notification-id={notification.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer px-4 py-3 outline-none transition focus-visible:bg-[#edf5f6] md:px-4 md:py-4 ${
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
                      if (notification.call_id) {
                        setSelectedRequestId(null);
                        setSelectedCallId(notification.call_id);
                      } else if (notification.request_id) {
                        setSelectedCallId(null);
                        setSelectedRequestId(notification.request_id);
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
                      if (notification.call_id) {
                        setSelectedRequestId(null);
                        setSelectedCallId(notification.call_id);
                      } else if (notification.request_id) {
                        setSelectedCallId(null);
                        setSelectedRequestId(notification.request_id);
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
                            {requesterText(uiLanguage, notification.title)}
                          </h2>

                          <span className="shrink-0 text-xs text-[#7a8a95]">
                            {requesterTimeAgo(
                              notification.created_at,
                              uiLanguage,
                            )}
                          </span>
                        </div>

                        <p className="mt-2 text-sm leading-6 text-[#5d7382]">
                          {requesterText(uiLanguage, notification.message)}
                        </p>

                        {(notification.call_id || notification.request_id) ? (
                          <button
                            type="button"
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
                              if (notification.call_id) {
                                setSelectedRequestId(null);
                                setSelectedCallId(notification.call_id);
                              } else if (notification.request_id) {
                                setSelectedCallId(null);
                                setSelectedRequestId(notification.request_id);
                              }
                            }}
                          >
                            {requesterText(uiLanguage, notification.call_id ? "View call details" : "View request details")}
                          </button>
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
            title={requesterText(uiLanguage, "No notifications")}
            description={requesterText(uiLanguage, "Status updates will appear here.")}
          />
        )}
      </Panel>
      <RequestDetailsSheet
        requestId={selectedRequestId}
        open={Boolean(selectedRequestId)}
        uiLanguage={uiLanguage}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
      />
      <CallDetailsSheet
        callId={selectedCallId}
        open={Boolean(selectedCallId)}
        uiLanguage={uiLanguage}
        onOpenChange={(open) => {
          if (!open) setSelectedCallId(null);
        }}
      />
    </div>
  );
}

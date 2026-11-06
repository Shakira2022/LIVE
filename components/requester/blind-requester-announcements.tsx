"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCall } from "@/components/calls/call-provider";
import { authenticatedFetch } from "@/lib/client-api";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import type { RequesterLanguage } from "@/lib/requester-language";
import { requesterText } from "@/lib/requester-ui";

type RequesterNotification = {
  id: string;
  title: string;
  message: string;
  read_at?: string | null;
  readAt?: string | null;
  read?: boolean;
};

type Props = { userId: string; userName: string; language: RequesterLanguage };

const SPEECH_LANGUAGE_TAG: Record<RequesterLanguage, string> = {
  English: "en-ZA", Afrikaans: "af-ZA", isiZulu: "zu-ZA", isiXhosa: "xh-ZA", Sesotho: "st-ZA",
  Setswana: "tn-ZA", Sepedi: "nso-ZA", siSwati: "ss-ZA", Tshivenda: "ve-ZA", isiNdebele: "nr-ZA", XiTsonga: "ts-ZA",
};

function pageIntroduction(pathname: string, userName: string, language: RequesterLanguage) {
  if (pathname === "/app/requester") return null;
  if (pathname === "/app/requester/new") return requesterText(language, "Request assistance. Choose Medical, Fire, or Police and complete the request form. Optional follow-up questions are only asked after a request is submitted, and only while you still have unanswered questions.");
  if (pathname === "/app/requester/history") return requesterText(language, "Request history. Your newest emergency requests appear first. Say open the first request to hear its details.");
  if (pathname === "/app/requester/notifications") return requesterText(language, "Notifications. Unread updates are read aloud automatically. Say read notifications to hear them again.");
  if (pathname === "/app/requester/settings") return requesterText(language, "Settings. Use System settings for appearance and language, Request settings for voice guidance, and Profile to review your saved information.");
  if (pathname === "/app/requester/profile") return requesterText(language, "Emergency profile. Your saved contact details and medical information are included with your requests.");
  if (pathname.startsWith("/app/requester/track/")) return requesterText(language, "Request tracking. I will tell you the current emergency status and announce when a responder is assigned or arrives.");
  if (pathname.startsWith("/app/requester/support")) return requesterText(language, "Requester help. Ask how to request help, follow an emergency, or manage your account. Say a topic to search for it.");
  return null;
}

export function BlindRequesterAnnouncements({ userId, userName, language }: Props) {
  const pathname = usePathname();
  const { call } = useCall();
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const speechQueueRef = useRef<Array<{ text: string; notificationId?: string }>>([]);
  const speakingRef = useRef(false);
  const seenNotificationIdsRef = useRef(new Set<string>());
  const queuedNotificationIdsRef = useRef(new Set<string>());
  const previousCallRef = useRef<typeof call | null>(null);
  const currentUserIdRef = useRef(userId);
  const pageInstructionsRef = useRef("");
  const lastSpokenRef = useRef("");
  const speakQueueRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (currentUserIdRef.current !== userId) {
      currentUserIdRef.current = userId;
      seenNotificationIdsRef.current.clear();
      queuedNotificationIdsRef.current.clear();
    }
  }, [userId]);

  useEffect(() => {
    const sync = () => {
      const next = readRequesterPreferences(userId).blindVoiceGuidance;
      enabledRef.current = next;
      setEnabled(next);
      if (!next) {
        speechQueueRef.current = [];
        seenNotificationIdsRef.current.clear();
        queuedNotificationIdsRef.current.clear();
        speakingRef.current = false;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("live:requester-preferences-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:requester-preferences-changed", sync);
    };
  }, [userId]);

  const enqueue = useCallback((text: string, notificationId?: string) => {
    if (!enabledRef.current || !text.trim()) return;
    if (notificationId && queuedNotificationIdsRef.current.has(notificationId)) return;
    if (notificationId) {
      queuedNotificationIdsRef.current.add(notificationId);
      seenNotificationIdsRef.current.add(notificationId);
    }
    lastSpokenRef.current = text.trim();
    speechQueueRef.current.push({ text: text.trim(), notificationId });
    speakQueueRef.current();
  }, []);

  speakQueueRef.current = () => {
    if (!enabledRef.current || speakingRef.current || !speechQueueRef.current.length || !("speechSynthesis" in window)) return;
    const entry = speechQueueRef.current.shift();
    if (!entry) return;
    const utterance = new SpeechSynthesisUtterance(entry.text);
    utterance.lang = SPEECH_LANGUAGE_TAG[language];
    utterance.rate = 0.94;
    speakingRef.current = true;
    utterance.onend = () => {
      speakingRef.current = false;
      if (entry.notificationId) {
        void authenticatedFetch(`/api/notifications/${encodeURIComponent(entry.notificationId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ read: true }),
        }).then((response) => {
          if (response.ok) window.dispatchEvent(new Event("live:notifications-changed"));
        }).catch(() => {});
      }
      window.setTimeout(() => speakQueueRef.current(), 0);
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      window.setTimeout(() => speakQueueRef.current(), 0);
    };
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!enabled) return;
    const text = pageIntroduction(pathname, userName, language);
    if (!text) return;
    pageInstructionsRef.current = text;
    const timer = window.setTimeout(() => enqueue(text), 700);
    return () => window.clearTimeout(timer);
  }, [enabled, enqueue, language, pathname, userName]);

  useEffect(() => {
    const onPageInstructions = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (text) pageInstructionsRef.current = text;
    };
    const onSpeechControl = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "stop") {
        speechQueueRef.current = [];
        speakingRef.current = false;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        return;
      }
      if (action !== "repeat") return;
      const text = pageInstructionsRef.current || lastSpokenRef.current || pageIntroduction(pathname, userName, language);
      if (!text) return;
      speechQueueRef.current = [];
      speakingRef.current = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      enqueue(text);
    };
    window.addEventListener("live:blind-page-instructions", onPageInstructions);
    window.addEventListener("live:blind-speech-control", onSpeechControl);
    return () => {
      window.removeEventListener("live:blind-page-instructions", onPageInstructions);
      window.removeEventListener("live:blind-speech-control", onSpeechControl);
    };
  }, [enqueue, language, pathname, userName]);

  useEffect(() => {
    const onAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; notificationId?: string }>).detail;
      if (detail?.text) enqueue(detail.text, detail.notificationId);
    };
    window.addEventListener("live:blind-announcement", onAnnouncement);
    return () => window.removeEventListener("live:blind-announcement", onAnnouncement);
  }, [enqueue]);

  useEffect(() => {
    if (!enabled || pathname === "/app/requester/notifications") return;
    let stopped = false;
    const checkNotifications = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const response = await authenticatedFetch("/api/notifications", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const payload = await response.json() as { data?: { notifications?: RequesterNotification[] }; notifications?: RequesterNotification[] };
        const notifications = payload.data?.notifications ?? payload.notifications ?? [];
        const unread = notifications.filter((item) => item.read === false || (item.read !== true && (item.read_at ?? item.readAt ?? null) === null));
        const unseen = unread.filter((item) => !seenNotificationIdsRef.current.has(item.id));
        unseen.forEach((item) => seenNotificationIdsRef.current.add(item.id));
        if (!unseen.length) return;
        enqueue(requesterText(language, unseen.length === 1 ? "You have one new notification." : "You have {count} new notifications.", { count: unseen.length }));
        unseen.forEach((item) => enqueue(`${requesterText(language, item.title)}. ${requesterText(language, item.message)}`, item.id));
      } catch {
        // Best effort: do not interrupt navigation or the current page.
      }
    };
    const initialTimer = window.setTimeout(() => void checkNotifications(), 1200);
    const timer = window.setInterval(() => void checkNotifications(), 5_000);
    return () => {
      stopped = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [enabled, enqueue, language, pathname, userId]);

  useEffect(() => {
    const previous = previousCallRef.current;
    previousCallRef.current = call;
    if (!enabled || !previous) return;
    if (call.status === "calling" && previous.status !== "calling") {
      const target = call.targetRole === "dispatcher" ? requesterText(language, "dispatcher")
        : call.targetRole === "responder" ? requesterText(language, "responder")
          : call.remoteName || requesterText(language, "contact");
      enqueue(requesterText(language, "Calling {name}.", { name: target }));
    } else if (call.status === "connected" && previous.status !== "connected") {
      enqueue(requesterText(language, "Call connected."));
    } else if (call.status === "idle" && previous.status !== "idle") {
      enqueue(requesterText(language, "Call ended."));
    } else if (call.status === "error" && previous.status !== "error") {
      enqueue(requesterText(language, "The call could not continue. {message}", { message: call.error || "Please try again." }));
    }
  }, [call, enabled, enqueue, language]);

  return null;
}

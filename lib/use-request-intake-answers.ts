"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readCached, writeFreshCache } from "@/lib/client-cache";
import { authenticatedFetch } from "@/lib/client-api";
import type { RequestIntakeAnswer } from "@/lib/requester-intake";

type PendingAnswer = Omit<RequestIntakeAnswer, "request_id" | "updated_at">;
type IntakeCache = {
  answers: Record<string, RequestIntakeAnswer>;
  pending: PendingAnswer[];
};

const EMPTY_CACHE: IntakeCache = { answers: {}, pending: [] };
const CACHE_TTL = 12 * 60 * 60_000;

function cacheKey(requestId: string) {
  return `requester-intake:v1:${requestId}`;
}

function eventName(requestId: string) {
  return `live-requester-intake:${requestId}`;
}

function mergeAnswers(...sources: Array<Record<string, RequestIntakeAnswer>>) {
  const merged: Record<string, RequestIntakeAnswer> = {};
  for (const source of sources) {
    for (const [key, answer] of Object.entries(source)) {
      const previous = merged[key];
      if (!previous || Date.parse(answer.updated_at) >= Date.parse(previous.updated_at)) merged[key] = answer;
    }
  }
  return merged;
}

export function useRequestIntakeAnswers(requestId: string | null | undefined) {
  const [answers, setAnswers] = useState<Record<string, RequestIntakeAnswer>>({});
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const stateRef = useRef<IntakeCache>(EMPTY_CACHE);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const syncPendingRef = useRef<(pending: PendingAnswer[]) => Promise<void>>(() => Promise.resolve());

  const applyCache = useCallback((next: IntakeCache, broadcast = false) => {
    stateRef.current = next;
    setAnswers(next.answers);
    if (requestId) writeFreshCache(cacheKey(requestId), next, CACHE_TTL);
    if (broadcast && requestId && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(eventName(requestId), { detail: next.answers }));
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(eventName(requestId));
        channel.postMessage(next.answers);
        channel.close();
      }
    }
  }, [requestId]);

  const receiveAnswers = useCallback((incoming: Record<string, RequestIntakeAnswer>) => {
    const current = stateRef.current;
    applyCache({ ...current, answers: mergeAnswers(current.answers, incoming) });
  }, [applyCache]);

  useEffect(() => {
    if (!requestId) {
      applyCache(EMPTY_CACHE);
      return;
    }

    const cached = readCached<IntakeCache>(cacheKey(requestId)) ?? EMPTY_CACHE;
    applyCache(cached);

    const handleLocal = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, RequestIntakeAnswer>>).detail;
      if (detail) receiveAnswers(detail);
    };
    window.addEventListener(eventName(requestId), handleLocal);
    const handleOnline = () => {
      const pending = stateRef.current.pending;
      if (pending.length) void syncPendingRef.current(pending);
    };
    window.addEventListener("online", handleOnline);

    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(eventName(requestId)) : null;
    if (channel) channel.onmessage = (event: MessageEvent<Record<string, RequestIntakeAnswer>>) => {
      if (event.data) receiveAnswers(event.data);
    };

    let cancelled = false;
    void authenticatedFetch(`/api/requester/requests/${encodeURIComponent(requestId)}/intake-answers`, {
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load saved emergency answers.");
      const payload = await response.json() as { data?: { answers?: RequestIntakeAnswer[] } };
      if (cancelled) return;
      const fetched = Object.fromEntries((payload.data?.answers ?? []).map((answer) => [answer.question_key, answer]));
      const current = stateRef.current;
      applyCache({ ...current, answers: mergeAnswers(fetched, current.answers) });
      if (current.pending.length) void syncPendingRef.current(current.pending);
    }).catch(() => {
      // Cached answers stay visible immediately when the network is unavailable.
    });

    return () => {
      cancelled = true;
      window.removeEventListener(eventName(requestId), handleLocal);
      window.removeEventListener("online", handleOnline);
      channel?.close();
    };
  }, [applyCache, receiveAnswers, requestId]);

  const syncPending = useCallback((pending: PendingAnswer[]) => {
    if (!requestId || pending.length === 0) return Promise.resolve();
    queueRef.current = queueRef.current.then(async () => {
      try {
        const response = await authenticatedFetch(`/api/requester/requests/${encodeURIComponent(requestId)}/intake-answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: pending }),
        });
        if (!response.ok) throw new Error("Failed to save the emergency answers.");
        const current = stateRef.current;
        const savedByKey = new Map(pending.map((answer) => [answer.question_key, answer]));
        applyCache({
          ...current,
          pending: current.pending.filter((answer) => {
            const saved = savedByKey.get(answer.question_key);
            return !saved || saved.answer !== answer.answer || saved.skipped !== answer.skipped || saved.question !== answer.question;
          }),
        });
        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    });
    return queueRef.current;
  }, [applyCache, requestId]);
  syncPendingRef.current = syncPending;

  const saveAnswers = useCallback((updates: PendingAnswer[]) => {
    if (!requestId || updates.length === 0) return;
    const now = new Date().toISOString();
    const persistedUpdates = updates.map((update) => ({ ...update, request_id: requestId, updated_at: now }));
    const current = stateRef.current;
    const updateMap = Object.fromEntries(persistedUpdates.map((answer) => [answer.question_key, answer]));
    const pendingMap = new Map(current.pending.map((answer) => [answer.question_key, answer]));
    for (const update of updates) pendingMap.set(update.question_key, update);
    const pending = [...pendingMap.values()];
    applyCache({
      answers: mergeAnswers(current.answers, updateMap),
      pending,
    }, true);
    setSyncStatus("saving");
    void syncPending(pending);
  }, [applyCache, requestId, syncPending]);

  const retryPending = useCallback(() => syncPending(stateRef.current.pending), [syncPending]);

  return { answers, syncStatus, saveAnswers, retryPending };
}

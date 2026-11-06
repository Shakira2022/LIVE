"use client";

import { useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client-api";
import type { RequestIntakeAnswer } from "@/lib/requester-intake";

function formatUpdatedTime(value?: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function RequestIntakeAnswers({ requestId }: { requestId: string }) {
  const [answers, setAnswers] = useState<RequestIntakeAnswer[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await authenticatedFetch(`/api/requester/requests/${encodeURIComponent(requestId)}/intake-answers`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load request answers.");
        const payload = await response.json() as { data?: { answers?: RequestIntakeAnswer[] } };
        if (active) {
          setAnswers(payload.data?.answers ?? []);
          setLoadError(false);
        }
      } catch {
        if (active) setLoadError(true);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 3000);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [requestId]);

  return (
    <div>
      {!answers.length ? (
        <p className="p-5 text-sm text-[#71828d]">{loadError ? "Could not load saved answers." : "No emergency questions have been answered or skipped yet."}</p>
      ) : (
        <dl className="divide-y divide-[#e2e8ed]">
          {answers.map((item) => (
            <div key={item.question_key} className="p-4">
              <dt className="text-sm font-semibold text-[#102b3f]">{item.question}</dt>
              <dd className={`mt-1 text-sm ${item.skipped ? "italic text-[#81909a]" : "text-[#526a78]"}`}>{item.skipped ? "Skipped by requester" : item.answer}</dd>
              <dd className="mt-1 text-[11px] text-[#81909a]">Updated {formatUpdatedTime(item.updated_at)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

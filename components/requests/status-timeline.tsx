import {
  Check,
  Clock3,
} from "lucide-react";
import type { StatusHistoryEntry } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function StatusTimeline({
  entries,
}: {
  entries: StatusHistoryEntry[];
}) {
  const orderedEntries = [...entries].reverse();

  return (
    <ol className="divide-y divide-[#e2e8ed] px-5 md:divide-y-0 md:p-5">
      {orderedEntries.map((entry, index) => (
        <li
          key={entry.id}
          className="relative flex gap-3 py-4 first:pt-4 last:pb-4 md:py-0 md:pb-5 md:last:pb-0"
        >
          {index < orderedEntries.length - 1 ? (
            <span className="absolute left-[15px] top-8 hidden h-[calc(100%-1.25rem)] w-px bg-[#d9e2e7] md:block" />
          ) : null}

          <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#b9dfe1] bg-[#e7f3f4] text-[#0f5b67]">
            {index === 0 ? (
              <Clock3 className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-semibold text-[#102b3f]">
                {entry.status}
              </p>
              <span className="text-xs text-[#7a8a95]">
                {formatDateTime(entry.timestamp)}
              </span>
            </div>

            <p className="mt-1 text-sm text-[#687b89]">
              {entry.actorName} · {entry.actorRole}
            </p>

            {entry.note ? (
              <p className="mt-2 text-sm leading-6 text-[#455d6d]">
                {entry.note}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

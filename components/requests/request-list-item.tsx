import Link from "next/link";
import {
  ChevronRight,
  Clock3,
  MapPin,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

import {
  requestStatusTone,
  timeAgo,
} from "@/lib/utils";

interface SupabaseEmergencyRequest {
  id: string;

  reference_code?:
    | string
    | null;

  requester_id?:
    | string
    | null;

  category?:
    | string
    | null;

  severity?:
    | string
    | null;

  note?:
    | string
    | null;

  callback_number?:
    | string
    | null;

  current_status?:
    | string
    | null;

  created_at?: string | null;

  updated_at?:
    | string
    | null;

  is_active?:
    | boolean
    | null;
}

export function RequestListItem({
  request,
  href,
  onClick,
  compact = false,
}: {
  request: SupabaseEmergencyRequest;
  href?: string;
  onClick?: () => void;
  compact?: boolean;
}) {
  const severityColour =
    request.severity === "Critical"
      ? "bg-[#d53f3d]"
      : request.severity === "High"
        ? "bg-[#b97018]"
        : "bg-[#0f5b67]";

  const status =
    request.current_status ||
    "submitted";

  const content = (
    <div className="flex items-start gap-3">
      {/* Severity indicator */}
      <span
        className={`mt-1 h-12 w-1 shrink-0 rounded-full md:h-11 md:w-1.5 ${severityColour}`}
      />

      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold tracking-[-0.01em] text-[#102b3f]">
                {request.category ||
                  "Emergency request"}
              </h3>

              <Badge
                tone={requestStatusTone(
                  status as any
                )}
              >
                {status}
              </Badge>
            </div>

            {/* Reference code */}
            <p className="mt-1 truncate text-xs font-semibold text-[#71828d]">
              {request.reference_code ||
                request.id}
            </p>
          </div>

          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[#9aa8b2] transition group-hover:translate-x-0.5 group-hover:text-[#0f5b67]" />
        </div>

        {/* Incident note */}
        {!compact ? (
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#536b7b]">
            {request.note ||
              "No incident note provided."}
          </p>
        ) : null}

        {/* Request information */}
        <div className="mt-3 grid gap-1.5 text-xs text-[#71828d] md:flex md:flex-wrap md:gap-x-4 md:gap-y-2">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />

            <span className="truncate">
              Emergency request
            </span>
          </span>

          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />

            {request.created_at
              ? timeAgo(request.created_at)
              : "Unknown time"}
          </span>
        </div>
      </div>
    </div>
  );

  const classes =
    "group block w-full border-b border-[#e2e8ed] bg-transparent px-5 py-4 text-left transition last:border-b-0 active:bg-[#eef4f6] md:bg-white md:px-5 md:py-5 md:hover:bg-[#f8fafb]";

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
    >
      {content}
    </button>
  );
}
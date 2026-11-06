import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format as formatDate, formatDistanceToNow } from "date-fns";
import type { RequestStatus, UserRole } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return formatDate(date, "dd MMM yyyy, HH:mm");
}

export function format(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return formatDate(date, "dd MMM yyyy, HH:mm");
}

export function timeAgo(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return formatDistanceToNow(date, {
    addSuffix: true,
  });
}

export function getDashboardRoute(role: UserRole) {
  return `/app/${role}`;
}

export function isActiveStatus(status: RequestStatus) {
  return !["Closed", "Cancelled", "Rejected"].includes(status);
}

export function nextStatus(status: RequestStatus): RequestStatus | null {
  const flow: RequestStatus[] = [
    "Submitted",
    "Received",
    "Assigned",
    "En route",
    "Arrived",
    "Closed",
  ];

  const index = flow.indexOf(status);

  return index >= 0 && index < flow.length - 1
    ? flow[index + 1]
    : null;
}

export function requestStatusTone(status: RequestStatus | string) {
  switch (status) {
    case "Submitted":
      return "blue";
    case "Received":
      return "violet";
    case "Assigned":
    case "Acknowledged":
      return "amber";
    case "En route":
      return "blue";
    case "Arrived":
    case "Completed":
      return "green";
    case "Closed":
      return "slate";
    case "Cancelled":
      return "red";
    case "Rejected":
      return "red";
    default:
      return "slate";
  }
}

export function formatRequestStatus(status: string | null | undefined) {
  const normalized = String(status ?? "submitted")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  const labels: Record<string, string> = {
    submitted: "Submitted",
    received: "Received",
    assigned: "Assigned",
    acknowledged: "Acknowledged",
    "en route": "En route",
    arrived: "Arrived",
    completed: "Completed",
    closed: "Closed",
    cancelled: "Cancelled",
    rejected: "Rejected",
  };

  return labels[normalized] ?? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function effectiveRequestStatus(requestStatus: string | null | undefined, assignmentStatus?: string | null) {
  const normalize = (value: string | null | undefined) =>
    String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const request = normalize(requestStatus) || "submitted";
  const assignment = normalize(assignmentStatus);
  const terminalStatuses = new Set(["closed", "cancelled", "rejected"]);
  if (!assignment || terminalStatuses.has(request)) return request;

  const activeAssignmentStatus = assignment === "acknowledged" ? "assigned" : assignment;
  const rank: Record<string, number> = {
    submitted: 0,
    received: 1,
    assigned: 2,
    en_route: 3,
    arrived: 4,
  };

  return (rank[activeAssignmentStatus] ?? -1) > (rank[request] ?? -1)
    ? activeAssignmentStatus
    : request;
}
export function generateReference() {
  return `LIVE-${Date.now()}`;
}

export function roleHome(role: UserRole) {
  return `/app/${role}`;
}

export function roleLabel(role: UserRole) {
  switch (role) {
    case "requester":
      return "Requester";
    case "dispatcher":
      return "Dispatcher";
    case "responder":
      return "Responder";
    case "admin":
      return "Administrator";
    case "auditor":
      return "Auditor";
    case "manager":
      return "Operations manager";
    default:
      return role;
  }
}

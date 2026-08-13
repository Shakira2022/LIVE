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

export function requestStatusTone(status: RequestStatus) {
  switch (status) {
    case "Submitted":
      return "blue";
    case "Received":
      return "violet";
    case "Assigned":
      return "amber";
    case "En route":
      return "blue";
    case "Arrived":
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
    default:
      return role;
  }
}
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import type { RequestStatus, UserRole } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string) {
  return format(new Date(value), "dd MMM yyyy, HH:mm");
}

export function timeAgo(value: string) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function roleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    requester: "Requester",
    dispatcher: "Dispatcher",
    responder: "Responder",
    admin: "Administrator",
    auditor: "Support / Auditor",
  };
  return labels[role];
}

export function roleHome(role: UserRole) {
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
  return index >= 0 && index < flow.length - 1 ? flow[index + 1] : null;
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
      return "teal";
    case "Arrived":
      return "green";
    case "Closed":
      return "slate";
    case "Cancelled":
    case "Rejected":
      return "red";
  }
}

export function generateReference() {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `LIVE-${day}-${suffix}`;
}

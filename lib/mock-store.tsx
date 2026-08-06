"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createInitialDatabase } from "@/lib/mock-data";
import type {
  CreateRequestInput,
  EmergencyRequest,
  MockDatabase,
  MockUser,
  RequestStatus,
} from "@/lib/types";
import { generateReference } from "@/lib/utils";

const DATABASE_KEY = "live-mock-database-v1";

interface MockStoreContextValue {
  db: MockDatabase | null;
  loading: boolean;
  createRequest: (input: CreateRequestInput) => EmergencyRequest;
  updateRequestStatus: (requestId: string, status: RequestStatus, actor: MockUser, note?: string) => void;
  assignResponder: (requestId: string, responderId: string, actor: MockUser) => void;
  addOperationalNote: (requestId: string, note: string, actor: MockUser) => void;
  cancelRequest: (requestId: string, actor: MockUser) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: (userId: string) => void;
  toggleUserStatus: (userId: string, actor: MockUser) => void;
  updateUserRole: (userId: string, role: MockUser["role"], actor: MockUser) => void;
  toggleOrganisationStatus: (organisationId: string, actor: MockUser) => void;
  rerouteRequest: (requestId: string, organisationId: string, actor: MockUser, reason: string) => void;
  rejectRequest: (requestId: string, actor: MockUser, reason: string) => void;
  toggleResponderAvailability: (responderId: string, actor: MockUser) => void;
  resetDemoData: () => void;
}

const MockStoreContext = createContext<MockStoreContextValue | undefined>(undefined);

function loadDatabase(): MockDatabase {
  const raw = localStorage.getItem(DATABASE_KEY);
  if (!raw) return createInitialDatabase();
  try {
    return JSON.parse(raw) as MockDatabase;
  } catch {
    return createInitialDatabase();
  }
}

function logEntry(db: MockDatabase, actor: MockUser, action: string, target: string, metadata: string) {
  db.auditLogs.unshift({
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    target,
    result: "Success",
    timestamp: new Date().toISOString(),
    correlationId: `corr-${Math.random().toString(16).slice(2, 8)}`,
    metadata,
  });
}

export function MockStoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<MockDatabase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadDatabase();
    setDb(stored);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (db) localStorage.setItem(DATABASE_KEY, JSON.stringify(db));
  }, [db]);

  function requireDb() {
    if (!db) throw new Error("Demo database is still loading");
    return db;
  }

  function createRequest(input: CreateRequestInput) {
    const current = requireDb();
    const now = new Date().toISOString();
    const request: EmergencyRequest = {
      id: generateReference(),
      requesterId: input.requester.id,
      requesterName: input.requester.name,
      callbackNumber: input.callbackNumber,
      emergencyContact: input.emergencyContact,
      category: input.category,
      severity: input.severity,
      note: input.note,
      status: "Submitted",
      createdAt: now,
      updatedAt: now,
      location: input.location,
      statusHistory: [
        {
          id: `history-${Date.now()}`,
          status: "Submitted",
          timestamp: now,
          actorName: input.requester.name,
          actorRole: input.requester.role,
          note: "Request submitted through the LIVE mock workflow.",
        },
      ],
      operationalNotes: [],
    };
    const next = structuredClone(current);
    next.requests.unshift(request);
    next.notifications.unshift({
      id: `notification-${Date.now()}`,
      userId: input.requester.id,
      title: "Request submitted",
      message: `Your request ${request.id} was stored and is awaiting dispatch review.`,
      requestId: request.id,
      createdAt: now,
      read: false,
      tone: "info",
    });
    logEntry(next, input.requester, "Emergency request created", request.id, input.category);
    setDb(next);
    return request;
  }

  function updateRequestStatus(requestId: string, status: RequestStatus, actor: MockUser, note?: string) {
    const current = requireDb();
    const next = structuredClone(current);
    const request = next.requests.find((item) => item.id === requestId);
    if (!request) return;
    const previous = request.status;
    const now = new Date().toISOString();
    request.status = status;
    request.updatedAt = now;
    if (["Closed", "Cancelled", "Rejected"].includes(status) && request.assignedResponderId) {
      const assigned = next.responders.find((item) => item.id === request.assignedResponderId);
      if (assigned) assigned.availability = "Available";
    }
    request.statusHistory.push({
      id: `history-${Date.now()}`,
      status,
      timestamp: now,
      actorName: actor.name,
      actorRole: actor.role,
      note,
    });
    if (status === "En route" && !request.etaMinutes) request.etaMinutes = 9;
    if (["Arrived", "Closed", "Cancelled", "Rejected"].includes(status)) request.etaMinutes = undefined;
    next.notifications.unshift({
      id: `notification-${Date.now()}`,
      userId: request.requesterId,
      title: `Request ${status.toLowerCase()}`,
      message: note || `Your request ${request.id} is now ${status.toLowerCase()}.`,
      requestId: request.id,
      createdAt: now,
      read: false,
      tone: status === "Rejected" ? "danger" : status === "Cancelled" ? "warning" : status === "Closed" || status === "Arrived" ? "success" : "info",
    });
    logEntry(next, actor, "Request status changed", request.id, `${previous} → ${status}`);
    setDb(next);
  }

  function assignResponder(requestId: string, responderId: string, actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const request = next.requests.find((item) => item.id === requestId);
    const responder = next.responders.find((item) => item.id === responderId);
    if (!request || !responder) return;
    const now = new Date().toISOString();
    if (request.assignedResponderId && request.assignedResponderId !== responderId) {
      const previousResponder = next.responders.find((item) => item.id === request.assignedResponderId);
      if (previousResponder) previousResponder.availability = "Available";
    }
    request.assignedResponderId = responderId;
    request.organisationId = responder.organisationId;
    request.status = "Assigned";
    request.etaMinutes = 12;
    request.updatedAt = now;
    request.statusHistory.push({
      id: `history-${Date.now()}`,
      status: "Assigned",
      timestamp: now,
      actorName: actor.name,
      actorRole: actor.role,
      note: `Assigned to ${responder.team} (${responder.vehicle}).`,
    });
    responder.availability = "Assigned";
    next.notifications.unshift({
      id: `notification-${Date.now()}`,
      userId: request.requesterId,
      title: "Response team assigned",
      message: `${responder.team} has been assigned to request ${request.id}.`,
      requestId: request.id,
      createdAt: now,
      read: false,
      tone: "success",
    });
    logEntry(next, actor, "Responder assigned", request.id, `${responder.name} / ${responder.vehicle}`);
    setDb(next);
  }

  function addOperationalNote(requestId: string, note: string, actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const request = next.requests.find((item) => item.id === requestId);
    if (!request || !note.trim()) return;
    request.operationalNotes.push(`${actor.name}: ${note.trim()}`);
    request.updatedAt = new Date().toISOString();
    logEntry(next, actor, "Operational note added", request.id, note.trim());
    setDb(next);
  }

  function cancelRequest(requestId: string, actor: MockUser) {
    updateRequestStatus(requestId, "Cancelled", actor, "Cancellation requested and recorded in the demo workflow.");
  }

  function markNotificationRead(id: string) {
    const current = requireDb();
    const next = structuredClone(current);
    const notification = next.notifications.find((item) => item.id === id);
    if (notification) notification.read = true;
    setDb(next);
  }

  function markAllNotificationsRead(userId: string) {
    const current = requireDb();
    const next = structuredClone(current);
    next.notifications.forEach((item) => {
      if (item.userId === userId) item.read = true;
    });
    setDb(next);
  }

  function toggleUserStatus(userId: string, actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const target = next.users.find((item) => item.id === userId);
    if (!target) return;
    target.status = target.status === "Active" ? "Suspended" : "Active";
    logEntry(next, actor, "User status changed", target.email, target.status);
    setDb(next);
  }

  function updateUserRole(userId: string, role: MockUser["role"], actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const target = next.users.find((item) => item.id === userId);
    if (!target || target.id === actor.id || target.role === role) return;
    const previousRole = target.role;
    target.role = role;
    logEntry(next, actor, "User role changed", target.email, `${previousRole} → ${role}`);
    setDb(next);
  }

  function toggleOrganisationStatus(organisationId: string, actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const organisation = next.organisations.find((item) => item.id === organisationId);
    if (!organisation) return;
    organisation.status = organisation.status === "Active" ? "Paused" : "Active";
    logEntry(next, actor, "Organisation status changed", organisation.name, organisation.status);
    setDb(next);
  }

  function rerouteRequest(requestId: string, organisationId: string, actor: MockUser, reason: string) {
    const current = requireDb();
    const next = structuredClone(current);
    const request = next.requests.find((item) => item.id === requestId);
    const organisation = next.organisations.find((item) => item.id === organisationId);
    if (!request || !organisation || !reason.trim()) return;

    const now = new Date().toISOString();
    const previousOrganisation = next.organisations.find((item) => item.id === request.organisationId);
    if (request.assignedResponderId) {
      const previousResponder = next.responders.find((item) => item.id === request.assignedResponderId);
      if (previousResponder) previousResponder.availability = "Available";
    }

    request.organisationId = organisationId;
    request.assignedResponderId = undefined;
    request.etaMinutes = undefined;
    request.status = "Received";
    request.updatedAt = now;
    request.statusHistory.push({
      id: `history-${Date.now()}`,
      status: "Received",
      timestamp: now,
      actorName: actor.name,
      actorRole: actor.role,
      note: `Rerouted to ${organisation.name}. Reason: ${reason.trim()}`,
    });
    request.operationalNotes.push(`${actor.name}: Rerouted from ${previousOrganisation?.name || "unassigned queue"} to ${organisation.name}. ${reason.trim()}`);
    next.notifications.unshift({
      id: `notification-${Date.now()}`,
      userId: request.requesterId,
      title: "Request rerouted",
      message: `Request ${request.id} has been transferred to ${organisation.name} for review.`,
      requestId: request.id,
      createdAt: now,
      read: false,
      tone: "info",
    });
    logEntry(next, actor, "Request rerouted", request.id, `${previousOrganisation?.name || "Unassigned"} → ${organisation.name}; ${reason.trim()}`);
    setDb(next);
  }

  function rejectRequest(requestId: string, actor: MockUser, reason: string) {
    if (!reason.trim()) return;
    updateRequestStatus(requestId, "Rejected", actor, reason.trim());
  }

  function toggleResponderAvailability(responderId: string, actor: MockUser) {
    const current = requireDb();
    const next = structuredClone(current);
    const responder = next.responders.find((item) => item.id === responderId);
    if (!responder || responder.availability === "Assigned") return;
    responder.availability = responder.availability === "Available" ? "Offline" : "Available";
    logEntry(next, actor, "Responder availability changed", responder.name, responder.availability);
    setDb(next);
  }

  function resetDemoData() {
    const initial = createInitialDatabase();
    setDb(initial);
    localStorage.setItem(DATABASE_KEY, JSON.stringify(initial));
  }

  const value = useMemo(
    () => ({
      db,
      loading,
      createRequest,
      updateRequestStatus,
      assignResponder,
      addOperationalNote,
      cancelRequest,
      markNotificationRead,
      markAllNotificationsRead,
      toggleUserStatus,
      updateUserRole,
      toggleOrganisationStatus,
      rerouteRequest,
      rejectRequest,
      toggleResponderAvailability,
      resetDemoData,
    }),
    [db, loading],
  );

  return <MockStoreContext.Provider value={value}>{children}</MockStoreContext.Provider>;
}

export function useMockStore() {
  const context = useContext(MockStoreContext);
  if (!context) throw new Error("useMockStore must be used inside MockStoreProvider");
  return context;
}

export type UserRole = "requester" | "dispatcher" | "responder" | "admin" | "auditor";

export type RequestStatus =
  | "Submitted"
  | "Received"
  | "Assigned"
  | "En route"
  | "Arrived"
  | "Closed"
  | "Cancelled"
  | "Rejected";

export type Severity = "Critical" | "High" | "Moderate";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  organisationId?: string;
  status: "Active" | "Suspended";
  initials: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface Organisation {
  id: string;
  name: string;
  type: "Hospital" | "Emergency response" | "Administration";
  serviceArea: string;
  phone: string;
  status: "Active" | "Paused";
  integration: "Mock dashboard" | "Sandbox API" | "Not configured";
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Responder {
  id: string;
  userId: string;
  name: string;
  team: string;
  vehicle: string;
  phone: string;
  organisationId: string;
  availability: "Available" | "Assigned" | "Offline";
  location: Coordinates;
}

export interface StatusHistoryEntry {
  id: string;
  status: RequestStatus;
  timestamp: string;
  actorName: string;
  actorRole: UserRole | "system";
  note?: string;
}

export interface EmergencyRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  callbackNumber: string;
  emergencyContact?: string;
  category: string;
  severity: Severity;
  note: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  location: Coordinates & {
    address: string;
    accuracy?: number;
    capturedAt: string;
    method: "GPS" | "Manual" | "Map pin";
  };
  organisationId?: string;
  assignedResponderId?: string;
  etaMinutes?: number;
  statusHistory: StatusHistoryEntry[];
  operationalNotes: string[];
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  requestId?: string;
  createdAt: string;
  read: boolean;
  tone: "info" | "success" | "warning" | "danger";
}

export interface AuditLog {
  id: string;
  actorName: string;
  actorRole: UserRole | "system";
  action: string;
  target: string;
  result: "Success" | "Denied" | "Warning";
  timestamp: string;
  correlationId: string;
  metadata: string;
}

export interface MockDatabase {
  requests: EmergencyRequest[];
  notifications: AppNotification[];
  users: MockUser[];
  organisations: Organisation[];
  responders: Responder[];
  auditLogs: AuditLog[];
}

export interface CreateRequestInput {
  requester: MockUser;
  callbackNumber: string;
  emergencyContact?: string;
  category: string;
  severity: Severity;
  note: string;
  location: EmergencyRequest["location"];
}

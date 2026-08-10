"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MOCK_CREDENTIALS } from "@/lib/mock-data";
import type { MockUser } from "@/lib/types";

const SESSION_KEY = "live-mock-session-v1";
const CUSTOM_USERS_KEY = "live-custom-users-v1";

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  password: string;
}

interface AuthContextValue {
  user: MockUser | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  register: (
    input: RegisterInput,
  ) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Only real UUIDs can safely be placed into
 * audit_logs.actor_user_id because that column
 * references users(id).
 */
function isUuid(value: string | undefined | null): boolean {
  if (!value) return false;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Sends an audit event to the server.
 *
 * Audit failures must NOT prevent the user from
 * logging in or using the application.
 */
async function recordAuditEvent(data: {
  action: string;
  targetType: string;
  targetId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  result: "success" | "denied" | "warning" | "failure";
  safeMetadata?: Record<string, unknown>;
}) {
  try {
    await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: data.action,
        target_type: data.targetType,
        target_id: data.targetId ?? null,
        actor_user_id: isUuid(data.actorUserId)
          ? data.actorUserId
          : null,
        actor_role: data.actorRole ?? null,
        result: data.result,
        safe_metadata: data.safeMetadata ?? {},
      }),
    });
  } catch (error) {
    console.error("Unable to record audit event:", error);
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = safeParse<MockUser | null>(
      localStorage.getItem(SESSION_KEY),
      null,
    );

    setUser(session);
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    await new Promise((resolve) => setTimeout(resolve, 450));

    const normalizedEmail = email.trim().toLowerCase();

    const customUsers = safeParse<
      Array<MockUser & { password: string }>
    >(
      localStorage.getItem(CUSTOM_USERS_KEY),
      [],
    );

    const account = [
      ...MOCK_CREDENTIALS,
      ...customUsers,
    ].find(
      (item) =>
        item.email.toLowerCase() === normalizedEmail &&
        item.password === password,
    );

    if (!account) {
      await recordAuditEvent({
        action: "LOGIN",
        targetType: "user",
        result: "denied",
        safeMetadata: {
          reason: "invalid_credentials",
        },
      });

      return {
        ok: false,
        message: "The email address or password is incorrect.",
      };
    }

    const storedDatabase = safeParse<{
      users?: MockUser[];
    } | null>(
      localStorage.getItem("live-mock-database-v1"),
      null,
    );

    const currentStatus =
      storedDatabase?.users?.find(
        (item) => item.id === account.id,
      )?.status ?? account.status;

    if (currentStatus === "Suspended") {
      await recordAuditEvent({
        action: "LOGIN",
        targetType: "user",
        targetId: account.id,
        actorUserId: account.id,
        actorRole: account.role,
        result: "denied",
        safeMetadata: {
          reason: "account_suspended",
        },
      });

      return {
        ok: false,
        message: "This demo account has been suspended.",
      };
    }

    const { password: _password, ...safeUser } = account;

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(safeUser),
    );

    localStorage.setItem(
      "live-mock-access-token",
      `mock.${btoa(safeUser.id)}.${Date.now()}`,
    );

    setUser(safeUser);

    await recordAuditEvent({
      action: "LOGIN",
      targetType: "user",
      targetId: safeUser.id,
      actorUserId: safeUser.id,
      actorRole: safeUser.role,
      result: "success",
    });

    return { ok: true };
  }

  async function register(input: RegisterInput) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  const email = input.email.trim().toLowerCase();

  const customUsers = safeParse<
    Array<MockUser & { password: string }>
  >(
    localStorage.getItem(CUSTOM_USERS_KEY),
    [],
  );

  const exists = [
    ...MOCK_CREDENTIALS,
    ...customUsers,
  ].some(
    (item) => item.email.toLowerCase() === email,
  );

  if (exists) {
    await recordAuditEvent({
      action: "REGISTER",
      targetType: "user",
      result: "denied",
      safeMetadata: {
        reason: "email_already_exists",
      },
    });

    return {
      ok: false,
      message: "An account with this email already exists.",
    };
  }

  const names = input.name.trim().split(/\s+/);

  const initials =
    names
      .slice(0, 2)
      .map((name) => name[0]?.toUpperCase())
      .join("") || "LU";

  const account: MockUser & { password: string } = {
    id: `usr-local-${Date.now()}`,
    name: input.name.trim(),
    email,
    phone: input.phone.trim(),
    emergencyContactName:
      input.emergencyContactName.trim(),
    emergencyContactPhone:
      input.emergencyContactPhone.trim(),
    password: input.password,
    role: "requester",
    status: "Active",
    initials,
  };

  const next = [...customUsers, account];

  localStorage.setItem(
    CUSTOM_USERS_KEY,
    JSON.stringify(next),
  );

  const { password: _password, ...safeUser } = account;

  const database = safeParse<{
    users?: MockUser[];
  } | null>(
    localStorage.getItem("live-mock-database-v1"),
    null,
  );

  if (
    database?.users &&
    !database.users.some(
      (item) => item.id === safeUser.id,
    )
  ) {
    database.users.push(safeUser);

    localStorage.setItem(
      "live-mock-database-v1",
      JSON.stringify(database),
    );
  }

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(safeUser),
  );

  localStorage.setItem(
    "live-mock-access-token",
    `mock.${btoa(safeUser.id)}.${Date.now()}`,
  );

  setUser(safeUser);

  await recordAuditEvent({
    action: "REGISTER",
    targetType: "user",
    targetId: safeUser.id,
    actorRole: safeUser.role,
    result: "success",
  });

  return { ok: true };
}

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(
      "live-mock-access-token",
    );

    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
    }),
    [user, loading],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider",
    );
  }

  return context;
}
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MockUser } from "@/lib/types";

const SESSION_KEY = "live-mock-session-v1";

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
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: email,
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
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
          message: result.message || "Unable to sign in.",
        };
      }

      const safeUser = result.user as MockUser;

      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(safeUser),
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
    } catch (error) {
      console.error("Login error:", error);

      return {
        ok: false,
        message: "Unable to connect to the server.",
      };
    }
  }

  async function register(input: RegisterInput) {
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        await recordAuditEvent({
          action: "REGISTER",
          targetType: "user",
          result: "denied",
          safeMetadata: {
            reason: "registration_failed",
          },
        });

        return {
          ok: false,
          message: result.message || "Unable to register.",
        };
      }

      const safeUser = result.user;

      const frontendUser: MockUser = {
        id: safeUser.id,
        name:
          safeUser.display_name ||
          `${safeUser.first_name} ${safeUser.last_name}`.trim(),
        email: safeUser.email,
        phone: safeUser.phone,
        role: safeUser.role,
        status: safeUser.status,
        initials:
          `${safeUser.first_name?.[0] || ""}${safeUser.last_name?.[0] || ""}`.toUpperCase(),
      };

      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(frontendUser),
      );

      setUser(frontendUser);

      await recordAuditEvent({
        action: "REGISTER",
        targetType: "user",
        targetId: frontendUser.id,
        actorUserId: frontendUser.id,
        actorRole: frontendUser.role,
        result: "success",
      });

      return {
        ok: true,
      };
    } catch (error) {
      console.error("Registration request failed:", error);

      return {
        ok: false,
        message: "Unable to connect to the registration service.",
      };
    }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("live-mock-access-token");

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
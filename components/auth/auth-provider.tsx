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
const ACCESS_TOKEN_KEY = "live-mock-access-token";

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
  ) => Promise<{
    ok: boolean;
    message?: string;
  }>;

  register: (
    input: RegisterInput,
  ) => Promise<{
    ok: boolean;
    message?: string;
  }>;

  logout: () => void;
}

const AuthContext =
  createContext<AuthContextValue | undefined>(
    undefined,
  );

function safeParse<T>(
  value: string | null,
  fallback: T,
): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isUuid(
  value: string | undefined | null,
): boolean {
  if (!value) {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/*
 * Audit events are optional.
 *
 * If the audit API fails, the login/register
 * process should still continue.
 */
async function recordAuditEvent(data: {
  action: string;
  targetType: string;
  targetId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;

  result:
    | "success"
    | "denied"
    | "warning"
    | "failure";

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

        target_type:
          data.targetType,

        target_id:
          data.targetId ?? null,

        actor_user_id:
          isUuid(data.actorUserId)
            ? data.actorUserId
            : null,

        actor_role:
          data.actorRole ?? null,

        result: data.result,

        safe_metadata:
          data.safeMetadata ?? {},
      }),
    });
  } catch (error) {
    console.error(
      "Unable to record audit event:",
      error,
    );
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] =
    useState<MockUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  /*
   * Restore the local session when the
   * application starts.
   */
  useEffect(() => {
    const storedUser =
      safeParse<MockUser | null>(
        localStorage.getItem(
          SESSION_KEY,
        ),
        null,
      );

    setUser(storedUser);

    setLoading(false);
  }, []);

  /*
   * LOGIN
   *
   * The backend authenticates the user and
   * returns:
   *
   * {
   *   ok: true,
   *   accessToken: "...",
   *   user: {...}
   * }
   */
  async function login(
    email: string,
    password: string,
  ) {
    try {
      const response =
        await fetch(
          "/api/auth/login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              identifier: email,
              password,
            }),
          },
        );

      let result: any = null;

      try {
        result =
          await response.json();
      } catch {
        result = null;
      }

      /*
       * Login failed.
       */
      if (
        !response.ok ||
        !result?.ok
      ) {
        await recordAuditEvent({
          action: "LOGIN",
          targetType: "user",
          result: "denied",

          safeMetadata: {
            reason:
              "invalid_credentials",
          },
        });

        return {
          ok: false,

          message:
            result?.message ||
            "Unable to sign in.",
        };
      }

      /*
       * Get the authenticated user.
       */
      const safeUser =
        result.user as MockUser;

      /*
       * Get the JWT returned by the
       * backend.
       */
      const accessToken =
        result.accessToken;

      /*
       * We expect a JWT after successful
       * authentication.
       */
      if (!accessToken) {
        console.error(
          "Login succeeded but no accessToken was returned.",
        );

        return {
          ok: false,

          message:
            "Login succeeded but no access token was returned.",
        };
      }

      /*
       * Save the user session.
       */
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(
          safeUser,
        ),
      );

      /*
       * Save the JWT.
       *
       * Other authenticated API calls can
       * retrieve it using:
       *
       * localStorage.getItem(
       *   "live-mock-access-token"
       * )
       */
      localStorage.setItem(
        ACCESS_TOKEN_KEY,
        accessToken,
      );

      /*
       * Update React state.
       */
      setUser(safeUser);

      console.log(
        "LOGIN SUCCESSFUL",
      );

      console.log(
        "JWT saved successfully.",
      );

      /*
       * Record successful login.
       */
      await recordAuditEvent({
        action: "LOGIN",

        targetType: "user",

        targetId:
          safeUser.id,

        actorUserId:
          safeUser.id,

        actorRole:
          safeUser.role,

        result: "success",
      });

      return {
        ok: true,
      };
    } catch (error) {
      console.error(
        "Login error:",
        error,
      );

      return {
        ok: false,

        message:
          "Unable to connect to the server.",
      };
    }
  }

  /*
   * REGISTER
   */
  async function register(
    input: RegisterInput,
  ) {
    try {
      const response =
        await fetch(
          "/api/register",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              input,
            ),
          },
        );

      let result: any = null;

      try {
        result =
          await response.json();
      } catch {
        result = null;
      }

      if (
        !response.ok ||
        !result?.ok
      ) {
        await recordAuditEvent({
          action: "REGISTER",

          targetType: "user",

          result: "denied",

          safeMetadata: {
            reason:
              "registration_failed",
          },
        });

        return {
          ok: false,

          message:
            result?.message ||
            "Unable to register.",
        };
      }

      const safeUser =
        result.user;

      /*
       * Convert backend user into the
       * frontend MockUser format.
       */
      const frontendUser: MockUser =
        {
          id: safeUser.id,

          name:
            safeUser.display_name ||
            `${safeUser.first_name ?? ""} ${
              safeUser.last_name ?? ""
            }`.trim(),

          email:
            safeUser.email,

          phone:
            safeUser.phone,

          role:
            safeUser.role,

          status:
            safeUser.status,

          initials:
            `${safeUser.first_name?.[0] || ""}${
              safeUser.last_name?.[0] || ""
            }`.toUpperCase(),
        };

      /*
       * Save the registered user.
       */
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(
          frontendUser,
        ),
      );

      /*
       * If registration also returns an
       * access token, save it.
       *
       * This keeps registration compatible
       * with either version of the backend.
       */
      if (result.accessToken) {
        localStorage.setItem(
          ACCESS_TOKEN_KEY,
          result.accessToken,
        );
      }

      setUser(frontendUser);

      await recordAuditEvent({
        action: "REGISTER",

        targetType: "user",

        targetId:
          frontendUser.id,

        actorUserId:
          frontendUser.id,

        actorRole:
          frontendUser.role,

        result: "success",
      });

      return {
        ok: true,
      };
    } catch (error) {
      console.error(
        "Registration request failed:",
        error,
      );

      return {
        ok: false,

        message:
          "Unable to connect to the registration service.",
      };
    }
  }

  /*
   * LOGOUT
   */
  function logout() {
    /*
     * Remove the local user session.
     */
    localStorage.removeItem(
      SESSION_KEY,
    );

    /*
     * Remove the JWT.
     */
    localStorage.removeItem(
      ACCESS_TOKEN_KEY,
    );

    /*
     * Clear React state.
     */
    setUser(null);

    console.log(
      "Logged out. JWT removed.",
    );
  }

  const value =
    useMemo(
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
    <AuthContext.Provider
      value={value}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider",
    );
  }

  return context;
}
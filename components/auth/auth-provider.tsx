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
    password: string
  ) => Promise<{ ok: boolean; message?: string }>;
  register: (
    input: RegisterInput
  ) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);

  /*
   * Restore the frontend user when the page loads.
   *
   * The actual authentication is handled by the
   * HTTP-only JWT cookie created by /api/auth/login.
   */
  useEffect(() => {
    const session = safeParse<MockUser | null>(
      localStorage.getItem(SESSION_KEY),
      null
    );

    setUser(session);
    setLoading(false);
  }, []);

  /*
   * LOGIN
   *
   * Flow:
   * 1. Send email/password to our backend.
   * 2. Backend finds the user in the users table.
   * 3. Backend verifies the bcrypt password.
   * 4. Backend creates the custom JWT.
   * 5. Backend stores the JWT in an HTTP-only cookie.
   * 6. Frontend stores only the safe user information.
   */
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

      console.log(
        "LOGIN API RESULT:",
        JSON.stringify(result, null, 2)
      );

      if (!response.ok || !result.ok) {
        return {
          ok: false,
          message:
            result.message || "Unable to sign in.",
        };
      }

      /*
       * The backend has already authenticated the user
       * and created the JWT cookie.
       *
       * We do NOT call:
       * supabase.auth.setSession()
       *
       * because this project uses custom JWT authentication.
       */
      const safeUser = result.user as MockUser;

      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(safeUser)
      );

      setUser(safeUser);

      console.log("LOGIN SUCCESSFUL");
      console.log("Authenticated user:", safeUser);

      return {
        ok: true,
      };
    } catch (error) {
      console.error("Login error:", error);

      return {
        ok: false,
        message: "Unable to connect to the server.",
      };
    }
  }

  /*
   * REGISTRATION
   *
   * Registration is handled by the backend.
   * Once registration succeeds, we store the safe
   * user information for the frontend.
   */
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

      console.log(
        "REGISTRATION API RESULT:",
        JSON.stringify(result, null, 2)
      );

      if (!response.ok || !result.ok) {
        return {
          ok: false,
          message:
            result.message || "Unable to register.",
        };
      }

      const safeUser = result.user;

      const frontendUser: MockUser = {
        id: safeUser.id,
        name:
          safeUser.display_name ||
          `${safeUser.first_name || ""} ${
            safeUser.last_name || ""
          }`.trim(),
        email: safeUser.email,
        phone: safeUser.phone,
        role: safeUser.role,
        status: safeUser.status,
        initials:
          `${safeUser.first_name?.[0] || ""}${
            safeUser.last_name?.[0] || ""
          }`.toUpperCase(),
      };

      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(frontendUser)
      );

      setUser(frontendUser);

      console.log(
        "REGISTRATION SUCCESSFUL:",
        frontendUser
      );

      return {
        ok: true,
      };
    } catch (error) {
      console.error(
        "Registration request failed:",
        error
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
   *
   * Clears the frontend session.
   *
   * NOTE:
   * The JWT is stored as an HTTP-only cookie, so JavaScript
   * cannot remove it directly.
   *
   * A dedicated /api/auth/logout endpoint can be added later
   * to clear the JWT cookie on the server.
   */
  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);

    console.log("USER LOGGED OUT");
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
    }),
    [user, loading]
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
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}
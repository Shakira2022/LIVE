'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { api, ApiClientError } from '@/lib/middleware/client/api';
import { clearAllClientCache } from '@/lib/client-cache';
import { applyDisplayTheme, regionalDefaultTheme } from '@/lib/display-theme';
import { CURRENT_TERMS_VERSION } from '@/lib/legal-terms';

import type {
  DisplayTheme,
  PublicUser,
  SessionResponse,
} from '@/types';

import type {
  MockUser,
  UserRole as UiRole,
} from '@/lib/types';

/* ============================================================
   TYPES
   ============================================================ */

export interface SessionUser extends MockUser {
  firstName: string;
  lastName: string;
  fullName: string;
  organisationName: string | null;
  accountStatus: PublicUser['status'];
  createdAt: string;
  displayTheme: PublicUser['displayTheme'];
  termsAcceptedAt: PublicUser['termsAcceptedAt'];
  termsAcceptedVersion: PublicUser['termsAcceptedVersion'];
  settingsSetupCompletedAt: PublicUser['settingsSetupCompletedAt'];
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  password: string;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
  user?: SessionUser;
  fieldErrors?: Record<string, string[]>;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;

  login: (
    identifier: string,
    password: string
  ) => Promise<AuthResult>;

  register: (
    input: RegisterInput
  ) => Promise<AuthResult>;

  logout: () => Promise<void>;

  refresh: () => Promise<void>;

  updateDisplayTheme: (theme: DisplayTheme) => Promise<boolean>;

  acceptTerms: () => Promise<void>;

  completeSettingsSetup: () => Promise<void>;
}

/* ============================================================
   ROLE / STATUS COMPATIBILITY
   ============================================================ */

const UI_ROLES: UiRole[] = [
  'requester',
  'dispatcher',
  'responder',
  'admin',
  'auditor',
  'manager',
];

function toUiRole(
  role: PublicUser['role']
): UiRole {
  return (UI_ROLES as string[]).includes(role)
    ? (role as UiRole)
    : 'auditor';
}

function toUiStatus(
  status: PublicUser['status']
): MockUser['status'] {
  return status === 'active'
    ? 'Active'
    : 'Suspended';
}

/* ============================================================
   SESSION USER MAPPER
   ============================================================ */

export function toSessionUser(
  user: PublicUser
): SessionUser {
  return {
    /* Existing UI fields */

    id: user.id,

    name: user.fullName,

    email: user.email ?? '',

    phone: user.phone ?? '',

    role: toUiRole(user.role),

    status: toUiStatus(user.status),

    initials: user.initials,

    organisationId:
      user.organisationId ?? undefined,

    emergencyContactName:
      user.emergencyContactName ?? undefined,

    emergencyContactPhone:
      user.emergencyContactPhone ?? undefined,

    /* Canonical API fields */

    firstName: user.firstName,

    lastName: user.lastName,

    fullName: user.fullName,

    organisationName:
      user.organisationName,

    accountStatus: user.status,

    createdAt: user.createdAt,

    displayTheme: user.displayTheme,

    termsAcceptedAt: user.termsAcceptedAt,

    termsAcceptedVersion: user.termsAcceptedVersion,

    settingsSetupCompletedAt: user.settingsSetupCompletedAt,
  };
}

function applyUserTheme(user: Pick<PublicUser, 'displayTheme'>) {
  if (user.displayTheme) {
    applyDisplayTheme(user.displayTheme, 'account');
  } else {
    applyDisplayTheme(regionalDefaultTheme(), 'default');
  }
}

/* ============================================================
   CONTEXT
   ============================================================ */

const AuthContext =
  createContext<AuthContextValue | undefined>(
    undefined
  );

/* ============================================================
   API ERROR CONVERSION
   ============================================================ */

function toFailure(
  error: unknown
): AuthResult {
  if (error instanceof ApiClientError) {
    return {
      ok: false,
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  }

  return {
    ok: false,
    message:
      'Unable to reach the server. Check your connection.',
  };
}

/* ============================================================
   AUTH PROVIDER
   ============================================================ */

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] =
    useState<SessionUser | null>(null);

  const [loading, setLoading] =
    useState(true);
  const authRevision = useRef(0);

  /* ==========================================================
     REFRESH AUTH SESSION
     ========================================================== */

  const refresh =
    useCallback(async () => {
      const revision = ++authRevision.current;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const session =
          await api<SessionResponse>(
            '/api/auth/me',
            { signal: controller.signal },
          );

        if (revision === authRevision.current) {
          applyUserTheme(session.user);
          setUser(toSessionUser(session.user));
        }
      } catch {
        /*
         * 401 here is normal when the
         * visitor is not signed in.
         */
        if (revision === authRevision.current) {
          applyDisplayTheme(regionalDefaultTheme(), 'default');
          setUser(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (revision === authRevision.current) setLoading(false);
      }
    }, []);

  /* ==========================================================
     INITIAL SESSION CHECK
     ========================================================== */

  useEffect(() => {
    /*
     * Remove the old browser-trusted
     * mock session.
     *
     * Authentication is now determined
     * by the HTTP-only JWT cookies and
     * GET /api/auth/me.
     */

    try {
      localStorage.removeItem(
        'live-mock-session-v1'
      );

      localStorage.removeItem(
        'live-mock-access-token'
      );
    } catch {
      // Ignore private browsing/storage errors.
    }

    clearAllClientCache();
    void refresh();
  }, [refresh]);

  /* ==========================================================
     LOGIN
     ========================================================== */

  const login =
    useCallback(
      async (
        identifier: string,
        password: string
      ): Promise<AuthResult> => {
        const revision = ++authRevision.current;
        try {
          clearAllClientCache();
          const session =
            await api<SessionResponse>(
              '/api/auth/login',
              {
                method: 'POST',

                body: {
                  identifier,
                  password,
                },
              }
            );

          // The login response is authoritative. Invalidate any session check
          // that started while the user was entering their credentials.
          ++authRevision.current;

          const nextUser =
            toSessionUser(
              session.user
            );

          applyUserTheme(session.user);
          setUser(nextUser);
          setLoading(false);

          return {
            ok: true,
            user: nextUser,
          };
        } catch (error) {
          if (revision === authRevision.current) setLoading(false);
          return toFailure(error);
        }
      },
      []
    );

  const updateDisplayTheme = useCallback(
    async (theme: DisplayTheme): Promise<boolean> => {
      const currentUser = user;
      if (!currentUser) return false;

      const previousTheme = currentUser.displayTheme ?? regionalDefaultTheme();
      applyDisplayTheme(theme, 'account');
      setUser((activeUser) => activeUser?.id === currentUser.id
        ? { ...activeUser, displayTheme: theme }
        : activeUser);

      try {
        await api<{ theme: DisplayTheme }>('/api/user/display-preferences', {
          method: 'PATCH',
          body: { theme },
        });
        return true;
      } catch {
        setUser((activeUser) => activeUser?.id === currentUser.id
          ? { ...activeUser, displayTheme: currentUser.displayTheme }
          : activeUser);
        applyDisplayTheme(previousTheme, currentUser.displayTheme ? 'account' : 'default');
        return false;
      }
    },
    [user],
  );

  const acceptTerms = useCallback(async () => {
    const accepted = await api<{ acceptedAt: string; version: string }>(
      '/api/user/terms-acceptance',
      { method: 'POST', body: { version: CURRENT_TERMS_VERSION } },
    );
    setUser((currentUser) => currentUser
      ? {
          ...currentUser,
          termsAcceptedAt: accepted.acceptedAt,
          termsAcceptedVersion: accepted.version,
        }
      : null);
  }, []);

  const completeSettingsSetup = useCallback(async () => {
    const completed = await api<{ completedAt: string }>(
      '/api/user/settings-setup',
      { method: 'POST', body: {} },
    );
    setUser((currentUser) => currentUser
      ? { ...currentUser, settingsSetupCompletedAt: completed.completedAt }
      : null);
  }, []);

  /* ==========================================================
     REGISTER

     IMPORTANT:

     Registration is NOT a JWT-login operation.

     /api/register:
       - creates the account
       - saves emergency contact
       - creates verification token
       - sends verification email

     The user signs in through
     /api/auth/login afterwards.
     ========================================================== */

 const register = useCallback(
  async (
    input: RegisterInput
  ): Promise<AuthResult> => {
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

            body:
              JSON.stringify(
                input
              ),
          }
        );

      let result:
        | {
            ok?: boolean;
            message?: string;
            email?: string;
            fieldErrors?: Record<
              string,
              string[]
            >;
          }
        | null = null;

      try {
        result =
          await response.json();
      } catch {
        return {
          ok: false,
          message:
            "The registration service returned an invalid response.",
        };
      }

      if (
        !response.ok ||
        !result?.ok
      ) {
        return {
          ok: false,

          message:
            result?.message ||
            "Unable to register.",

          fieldErrors:
            result?.fieldErrors,
        };
      }

      /*
       * IMPORTANT:
       *
       * Registration does NOT create a login session.
       *
       * Account:
       * pending → email verification → active → login
       */

      return {
        ok: true,

        message:
          result.message ||
          "Registration successful. Check your email and click Verify email.",
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
  },
  []
);

  /* ==========================================================
     LOGOUT
     ========================================================== */

  const logout =
    useCallback(async () => {
      ++authRevision.current;
      clearAllClientCache();
      try {
        await api(
          '/api/auth/logout',
          {
            method: 'POST',
          }
        );
      } catch (error) {
        /*
         * Even if the network request fails,
         * remove the authenticated UI state.
         */
        console.error(
          'Logout request failed:',
          error
        );
      } finally {
        applyDisplayTheme(regionalDefaultTheme(), 'default');
        setUser(null);
      }
    }, []);

  /* ==========================================================
     CONTEXT VALUE
     ========================================================== */

  const value =
    useMemo(
      () => ({
        user,
        loading,
        login,
        register,
        logout,
        refresh,
        updateDisplayTheme,
        acceptTerms,
        completeSettingsSetup,
      }),
      [
        user,
        loading,
        login,
        register,
        logout,
        refresh,
        updateDisplayTheme,
        acceptTerms,
        completeSettingsSetup,
      ]
    );

  return (
    <AuthContext.Provider
      value={value}
    >
      {children}
    </AuthContext.Provider>
  );
}

/* ============================================================
   HOOK
   ============================================================ */

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used inside AuthProvider'
    );
  }

  return context;
}

/**
 * SESSION PROVIDER   (Block 2 Person 6, Block 3 Person 1)
 *
 * Replaces the localStorage session with a real server-verified one, WITHOUT
 * forcing the 18 pages that call useAuth() to change yet.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * Before: login() stored the whole user object in localStorage and every page
 *   trusted `user.role` from there. A user could open devtools, set
 *   localStorage to {"role":"admin"}, reload, and the app would render the
 *   admin screens. Nothing on the server disagreed, because nothing on the
 *   server was asked.
 *
 * After: the server issues httpOnly cookies that JavaScript cannot read or
 *   forge. Identity comes from GET /api/auth/me on mount. Editing anything in
 *   the browser now changes nothing, because the role that matters is the one
 *   inside the signed token, checked on every API call and by middleware.ts
 *   before a protected page is even rendered.
 *
 * THE COMPATIBILITY SHIM
 *
 * The API speaks `PublicUser` (see types/index.ts): camelCase, `fullName`,
 * lowercase `status`. The existing UI speaks `MockUser` (see lib/types.ts):
 * `name`, `initials`, Title-Case `status`.
 *
 * `SessionUser` below is deliberately BOTH. It extends `MockUser`, so every
 * existing page and every `lib/mock-store.tsx` call that takes an `actor`
 * keeps compiling untouched, while the canonical API fields are also present
 * for new code to use.
 *
 * This is a BRIDGE, not the destination. Block 3 migrates pages onto the
 * canonical fields one at a time; when the last `user.name` is gone, delete
 * the MockUser half of this type and the `toSessionUser` mapping with it.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiClientError } from '@/lib/middleware/client/api';
import type { PublicUser, SessionResponse } from '@/types';
import type { MockUser, UserRole as UiRole } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* The bridge type                                                             */
/* -------------------------------------------------------------------------- */

export interface SessionUser extends MockUser {
  /** Canonical fields straight from the API, for new code to prefer. */
  firstName: string;
  lastName: string;
  fullName: string;
  organisationName: string | null;
  /** The real lowercase account_status value. `status` is the display form. */
  accountStatus: PublicUser['status'];
  createdAt: string;
}

/**
 * `lib/types.ts` has no 'support' role but the database enum does. Anything
 * unexpected is shown as an auditor, which is the least-privileged staff view —
 * this only affects LABELS. Real permissions come from the signed token, which
 * still carries the true role.
 */
const UI_ROLES: UiRole[] = ['requester', 'dispatcher', 'responder', 'admin', 'auditor'];

function toUiRole(role: PublicUser['role']): UiRole {
  return (UI_ROLES as string[]).includes(role) ? (role as UiRole) : 'auditor';
}

/** MockUser only models Active/Suspended; everything else reads as Suspended. */
function toUiStatus(status: PublicUser['status']): MockUser['status'] {
  return status === 'active' ? 'Active' : 'Suspended';
}

export function toSessionUser(user: PublicUser): SessionUser {
  return {
    // --- MockUser half: what the existing UI reads -------------------------
    id: user.id,
    name: user.fullName,
    email: user.email ?? '',
    phone: user.phone ?? '',
    role: toUiRole(user.role),
    status: toUiStatus(user.status),
    initials: user.initials,
    organisationId: user.organisationId ?? undefined,
    emergencyContactName: user.emergencyContactName ?? undefined,
    emergencyContactPhone: user.emergencyContactPhone ?? undefined,

    // --- Canonical half: what new code should use --------------------------
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    organisationName: user.organisationName,
    accountStatus: user.status,
    createdAt: user.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

interface RegisterInput {
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
  /** Present when ok. Use this to redirect — do NOT read localStorage. */
  user?: SessionUser;
  /** Field-level messages from the validation stage, for inline form errors. */
  fieldErrors?: Record<string, string[]>;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<AuthResult>;
  register: (input: RegisterInput) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toFailure(error: unknown): AuthResult {
  if (error instanceof ApiClientError) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  }
  return { ok: false, message: 'Unable to reach the server. Check your connection.' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await api<SessionResponse>('/api/auth/me');
      setUser(toSessionUser(session.user));
    } catch {
      // Not signed in is a normal state, not an error worth surfacing.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Clear the old mock session so a stale object cannot linger and confuse
    // anyone debugging. Safe to delete once every environment has moved over.
    try {
      localStorage.removeItem('live-mock-session-v1');
      localStorage.removeItem('live-mock-access-token');
    } catch {
      /* private browsing */
    }
    void refresh();
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string): Promise<AuthResult> => {
    try {
      const session = await api<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      const next = toSessionUser(session.user);
      setUser(next);
      return { ok: true, user: next };
    } catch (error) {
      return toFailure(error);
    }
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<AuthResult> => {
    try {
      const session = await api<SessionResponse>('/api/auth/register', {
        method: 'POST',
        body: input,
      });
      const next = toSessionUser(session.user);
      setUser(next);
      return { ok: true, user: next };
    } catch (error) {
      return toFailure(error);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      // The cookies are cleared server-side either way; never trap the user in
      // a signed-in-looking UI because the logout call failed.
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

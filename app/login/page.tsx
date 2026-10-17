"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { DemoAccountPicker } from "@/components/auth/demo-account-picker";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";
import { roleHome } from "@/lib/utils";
import { writeFreshCache } from "@/lib/client-cache";

type WarmRequest = {
  id?: string;
  currentStatus?: string;
  current_status?: string;
  status?: string;
};

type WarmPayload = {
  data?: {
    items?: WarmRequest[];
    notifications?: Array<Record<string, unknown>>;
  };
  items?: WarmRequest[];
  requests?: WarmRequest[];
  notifications?: Array<Record<string, unknown>>;
};

async function warmRequesterCache(userId: string) {
  try {
    const [requestsResult, notificationsResult] = await Promise.allSettled([
      fetch("/api/requests?limit=100&offset=0", {
        credentials: "include",
        cache: "no-store",
      }),
      fetch("/api/notifications", {
        credentials: "include",
        cache: "no-store",
      }),
    ]);

    if (requestsResult.status === "fulfilled" && requestsResult.value.ok) {
      const payload = await requestsResult.value.json() as WarmPayload;
      const requests = payload.data?.items ?? payload.items ?? payload.requests ?? [];
      const active = requests.find((request) =>
        ["submitted", "received", "assigned", "acknowledged", "en_route", "arrived"].includes(
          request.currentStatus ?? request.current_status ?? request.status ?? "",
        ),
      );

      writeFreshCache(`requester-history:${userId}`, requests, 5 * 60_000);
      writeFreshCache(
        `requester-active-request:${userId}`,
        { id: active?.id ?? null },
        active ? 5 * 60_000 : 30_000,
      );
    }

    if (notificationsResult.status === "fulfilled" && notificationsResult.value.ok) {
      const payload = await notificationsResult.value.json() as WarmPayload;
      const notifications = Array.isArray(payload.data?.notifications)
        ? payload.data.notifications
        : Array.isArray(payload.data?.items)
          ? payload.data.items
          : Array.isArray(payload.notifications)
            ? payload.notifications
            : [];

      writeFreshCache(`requester-notifications:${userId}`, notifications, 5 * 60_000);
    }
  } catch {
    // Login must still complete if a background prefetch response is malformed.
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState(
    "requester@live.co.za"
  );
  const [password, setPassword] = useState(
    "LiveUser123!"
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slowLogin, setSlowLogin] = useState(false);

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setSlowLogin(false);

    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => undefined, 0);
    const timeoutResult = new Promise<Awaited<ReturnType<typeof login>>>((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        resolve({
          ok: false,
          message: "Sign in is taking too long. Please try again later.",
        });
      }, 8000);
    });

    const result = await Promise.race([
      login(email, password),
      timeoutResult,
    ]);

    clearTimeout(timeoutId);

    if (timedOut) {
      setSlowLogin(true);
    }

    if (!result.ok || !result.user) {
      setBusy(false);
      setError(
        result.message || "Unable to sign in."
      );
      return;
    }

    // The session now lives in httpOnly cookies, so there is nothing to read
    // back from localStorage. Redirect using the user the server just returned.
    //
    // If middleware.ts turned this visit away from a protected page it left
    // ?next= behind, so send them where they were actually going. Only
    // same-origin relative paths are accepted, otherwise ?next= would be an
    // open redirect.
    const requested = new URLSearchParams(
      window.location.search
    ).get("next");

    const safeNext =
      requested &&
      requested.startsWith("/") &&
      !requested.startsWith("//")
        ? requested
        : null;

    if (result.user.role === "requester") {
      // Populate the first screens before navigation so they never render an
      // empty initial state while the cache is being filled.
      await Promise.race([
        warmRequesterCache(result.user.id),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }

    router.replace(safeNext ?? roleHome(result.user.role));
  }

  return (
    <div className="min-h-dvh bg-[#f5f7f9]">
      <PublicHeader disabled={busy} />

      <main className="grid min-h-dvh place-items-center px-5 pb-8 pt-20 sm:px-6">
        <div className="w-full max-w-md">
          <div className="relative top-2 mb-7 text-center">
            <h1 className="text-3xl font-bold tracking-[-0.025em]">
              Sign in
            </h1>

            <p className="mt-2 text-sm leading-6 text-[#667b89]">
              Access your secure emergency-response workspace.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="w-full border-b border-[#dce5ea] py-5 sm:py-6"
          >
            <fieldset disabled={busy} className="min-w-0 border-0 p-0">
              <div className="mx-auto mb-5 h-px w-1/2 bg-[#dce5ea] sm:mb-6" aria-hidden="true" />

              <div>
              <FieldLabel>
                Email address
              </FieldLabel>

              <Input
                type="email"
                autoComplete="email"
                placeholder="Type in here"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              </div>

              <div className="mt-4">
              <div className="flex items-center justify-between">
                <FieldLabel>
                  Password
                </FieldLabel>

                <Link
                  href="/forgot-password"
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : undefined}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                  className={`mb-2 text-xs font-semibold transition ${busy ? "pointer-events-none cursor-not-allowed text-[#9aaab3]" : "text-[#0f6872]"}`}
                >
                  Forgot?
                </Link>
              </div>

              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Type in here"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              </div>

              {error ? (
              <p className="mt-4 rounded-xl border border-[#efc9c7] bg-[#ffefee] px-3 py-2.5 text-sm font-medium text-[#a93331]">
                {error}
              </p>
              ) : null}

              <Button
              type="submit"
              size="lg"
              className="mt-5 w-full"
              disabled={busy}
              >
              {busy
                ? "Signing in..."
                : "Sign in"}
              </Button>

              <p className="mt-3 text-center text-xs text-[#748693]">
              By signing in, you agree to our{" "}
              <Link
                href="/terms-and-conditions"
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
                className={`font-semibold underline underline-offset-2 ${busy ? "pointer-events-none text-[#9aaab3]" : "text-[#0f6872]"}`}
              >
                Terms and Conditions
              </Link>
              .
              </p>
            </fieldset>

          </form>

          <p className="mt-5 text-center text-sm text-[#687b89]">
            New requester?{" "}
            <Link
              href="/register"
              aria-disabled={busy}
              tabIndex={busy ? -1 : undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
              className={`font-semibold ${busy ? "pointer-events-none text-[#9aaab3]" : "text-[#0f6872]"}`}
            >
              Create an account
            </Link>
          </p>

          <div className="mt-5">
            <DemoAccountPicker
              onPick={(demoEmail, demoPassword) => {
                setEmail(demoEmail);
                setPassword(demoPassword);
              }}
            />
          </div>
        </div>
      </main>

      {slowLogin ? (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-[#e6c9a6] bg-[#fff8ed] px-4 py-3 text-center text-sm font-semibold text-[#8a5a16] shadow-lg"
        >
          Sign in is taking too long. Please try again later.
        </div>
      ) : null}
    </div>
  );
}

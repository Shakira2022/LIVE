"use client";

import {
  LockKeyhole,
  Mail,
  RadioTower,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DemoAccountPicker } from "@/components/auth/demo-account-picker";
import { useAuth } from "@/components/auth/auth-provider";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";
import { roleHome } from "@/lib/utils";

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

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setBusy(true);
    setError("");

    const result = await login(email, password);

    setBusy(false);

    if (!result.ok) {
      setError(
        result.message || "Unable to sign in."
      );
      return;
    }

    const raw = localStorage.getItem(
      "live-mock-session-v1"
    );

    if (raw) {
      const session = JSON.parse(raw);
      router.replace(roleHome(session.role));
    }
  }

  return (
    <div className="min-h-dvh bg-[#f5f7f9]">
      <PublicHeader />

      <main className="grid min-h-dvh place-items-center px-4 pb-10 pt-24">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#102b3f] text-white shadow-lg">
              <RadioTower className="h-6 w-6" />
            </span>

            <h1 className="mt-5 text-3xl font-bold tracking-[-0.025em]">
              Welcome to LIVE
            </h1>

            <p className="mt-2 text-sm leading-6 text-[#667b89]">
              Sign in to open the workspace for
              your demo role.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="p-5 sm:p-7"
          >
            <div>
              <FieldLabel>
                Email address
              </FieldLabel>

              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#8a9aa5]" />

                <Input
                  className="pl-11"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <FieldLabel>
                  Password
                </FieldLabel>

                <Link
                  href="/forgot-password"
                  className="mb-2 text-xs font-semibold text-[#0f6872]"
                >
                  Forgot?
                </Link>
              </div>

              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#8a9aa5]" />

                <Input
                  className="pl-11"
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  required
                />
              </div>
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
                ? "Opening workspace..."
                : "Sign in"}
            </Button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#e0e7ec]" />

              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9aa7b0]">
                or
              </span>

              <span className="h-px flex-1 bg-[#e0e7ec]" />
            </div>

            <DemoAccountPicker
              onPick={(
                pickedEmail,
                pickedPassword
              ) => {
                setEmail(pickedEmail);
                setPassword(pickedPassword);
                setError("");
              }}
            />
          </form>

          <p className="mt-5 text-center text-sm text-[#687b89]">
            New requester?{" "}
            <Link
              href="/register"
              className="font-semibold text-[#0f6872]"
            >
              Create an account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
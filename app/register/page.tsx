"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [
    emergencyContactName,
    setEmergencyContactName,
  ] = useState("");
  const [
    emergencyContactPhone,
    setEmergencyContactPhone,
  ] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setBusy(true);
    setError("");

    const result = await register({
      name,
      email,
      phone,
      emergencyContactName,
      emergencyContactPhone,
      password,
    });

    setBusy(false);

    if (!result.ok) {
      setError(
        result.message || "Unable to register"
      );
      return;
    }

    router.replace("/app/requester");
  }

  return (
    <div className="min-h-dvh bg-[#f5f7f9]">
      <PublicHeader />

      <main className="grid min-h-dvh place-items-center px-4 pb-10 pt-24">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold tracking-[-0.025em]">
              Create a requester account
            </h1>

            <p className="mt-2 text-sm text-[#667b89]">
              Your phone and emergency-contact
              details will be used automatically when
              you request help.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="grid gap-4 p-5 sm:p-7"
          >
            <label>
              <FieldLabel>
                Full name
              </FieldLabel>

              <Input
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                required
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <FieldLabel>
                  Email
                </FieldLabel>

                <Input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                />
              </label>

              <label>
                <FieldLabel>
                  Phone
                </FieldLabel>

                <Input
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <FieldLabel>
                  Emergency contact name
                </FieldLabel>

                <Input
                  value={emergencyContactName}
                  onChange={(event) =>
                    setEmergencyContactName(
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              <label>
                <FieldLabel>
                  Emergency contact phone
                </FieldLabel>

                <Input
                  value={emergencyContactPhone}
                  onChange={(event) =>
                    setEmergencyContactPhone(
                      event.target.value
                    )
                  }
                  required
                />
              </label>
            </div>

            <label>
              <FieldLabel>
                Password
              </FieldLabel>

              <Input
                type="password"
                minLength={8}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
              />
            </label>

            {error ? (
              <p className="rounded-xl bg-[#ffefee] p-3 text-sm font-medium text-[#a93331]">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={busy}
            >
              {busy
                ? "Creating account..."
                : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-[#687b89]">
            Already registered?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#0f6872]"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setError("Please enter your full name.");
      setBusy(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanEmergencyName =
    emergencyContactName.trim();
      const cleanEmergencyPhone =
      emergencyContactPhone.trim();

    // Name validation
    if (cleanName.length < 2) {
      setError("Please enter your full name.");
      setBusy(false);
      return;
    }

    // Email validation
    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      setBusy(false);
      return;
    }

    // Phone validation
    const phonePattern =
      /^0\d{9}$/;

    if (!phonePattern.test(cleanPhone)) {
      setError("Please enter a valid phone number.");
      setBusy(false);
      return;
    }

    if (!phonePattern.test(cleanEmergencyPhone)) {
      setError(
        "Please enter a valid emergency contact phone number."
      );
      setBusy(false);
      return;
    }

    // Password validation
    if (password.length < 8) {
      setError(
        "Password must be at least 8 characters long."
      );
      setBusy(false);
      return;
    }

    if (!/[A-Za-z]/.test(password)) {
      setError(
        "Password must contain at least one letter."
      );
      setBusy(false);
      return;
    }

    if (!/[0-9]/.test(password)) {
      setError(
        "Password must contain at least one number."
      );
      setBusy(false);
      return;
    }

    const result = await register({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      emergencyContactName: cleanEmergencyName,
      emergencyContactPhone: cleanEmergencyPhone,
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
  );
}
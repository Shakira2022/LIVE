"use client";

import Link from "next/link";
import { useState } from "react";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        "/api/auth/forgot-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "Something went wrong. Please try again."
        );
        return;
      }

      setSent(true);
    } catch (error) {
      console.error(
        "FORGOT PASSWORD ERROR:",
        error
      );

      setError(
        "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#f6f8fb]">
      <PublicHeader />

      <main className="grid min-h-dvh place-items-center px-4 pb-10 pt-24">
        <div className="w-full max-w-md p-6 sm:p-8">

          {sent ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold">
                Recovery token generated
              </h1>

              <p className="mt-3 text-sm leading-6 text-[#667b89]">
                Your password recovery request has
                been created.
              </p>

              <div className="mt-5 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-left text-sm leading-6 text-yellow-800">
                <strong>Development mode:</strong>
                <br />
                The reset token is available in the
                development terminal. Copy the token
                from the terminal and use it on the
                Reset Password page.
              </div>

              <Link
                href="/reset-password"
                className="block"
              >
                <Button
                  type="button"
                  className="mt-6 w-full"
                  size="lg"
                >
                  Continue to reset password
                </Button>
              </Link>

              <Link
                href="/login"
                className="mt-5 block text-sm text-[#0f6872]"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h1 className="text-2xl font-bold tracking-[-0.03em]">
                Recover your account
              </h1>

              <p className="mt-2 text-sm leading-6 text-[#667b89]">
                Enter your email to start the password
                recovery process.
              </p>

              <label className="mt-6 block">
                <FieldLabel>
                  Email address
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

              {error && (
                <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="mt-5 w-full"
                size="lg"
                disabled={loading}
              >
                {loading
                  ? "Processing..."
                  : "Continue"}
              </Button>

              <Link
                href="/login"
                className="mt-5 block text-center text-sm text-[#0f6872]"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
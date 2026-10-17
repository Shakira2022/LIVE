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

      <main className="grid min-h-dvh place-items-center px-5 pb-8 pt-20 sm:px-6">
        <div className="w-full max-w-md">

          {sent ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold">
                Check your email
              </h1>

              <p className="mt-3 text-sm leading-6 text-[#667b89]">
                If an account exists for that address, we have sent password-reset instructions.
              </p>

            </div>
          ) : (
            <form onSubmit={handleSubmit} className="border-b border-[#dce5ea] py-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-[-0.03em]">
                  Recover your account
                </h1>

                <p className="mt-2 text-sm leading-6 text-[#667b89]">
                  Enter your email address and we will send a secure reset link.
                </p>
              </div>

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
                  ? "Sending instructions..."
                  : "Send reset link"}
              </Button>

            </form>
          )}
        </div>
      </main>
    </div>
  );
}

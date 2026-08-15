"use client";

import Link from "next/link";
import { useState } from "react";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (newPassword.length < 8) {
      setError(
        "Password must be at least 8 characters."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        "/api/auth/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: token.trim(),
            newPassword,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "Unable to reset password."
        );
        return;
      }

      setSuccess(true);
    } catch (error) {
      console.error(
        "RESET PASSWORD REQUEST ERROR:",
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

          {success ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold">
                Password updated
              </h1>

              <p className="mt-3 text-sm leading-6 text-[#667b89]">
                Your password has been changed
                successfully.
              </p>

              <Link
                href="/login"
                className="block"
              >
                <Button
                  type="button"
                  className="mt-6 w-full"
                  size="lg"
                >
                  Return to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">
                Reset your password
              </h1>

              <p className="mt-2 text-sm leading-6 text-[#667b89]">
                Enter your reset token and choose a
                new password.
              </p>

              <form
                onSubmit={handleSubmit}
                className="mt-6"
              >
                <label className="block">
                  <span className="text-sm font-medium">
                    Reset token
                  </span>

                  <Input
                    type="text"
                    value={token}
                    onChange={(event) =>
                      setToken(event.target.value)
                    }
                    placeholder="Enter reset token"
                    required
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-sm font-medium">
                    New password
                  </span>

                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) =>
                      setNewPassword(
                        event.target.value
                      )
                    }
                    placeholder="Enter new password"
                    required
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-sm font-medium">
                    Confirm new password
                  </span>

                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(
                        event.target.value
                      )
                    }
                    placeholder="Confirm new password"
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
                    ? "Updating password..."
                    : "Reset password"}
                </Button>
              </form>

              <Link
                href="/login"
                className="mt-5 block text-center text-sm text-[#0f6872]"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
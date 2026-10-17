"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/field";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (queryToken) setToken(queryToken);
  }, []);

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

      <main className="grid min-h-dvh place-items-center px-5 pb-8 pt-20 sm:px-6">
        <div className="w-full max-w-md">

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
              <div className="relative top-2 mb-7 text-center">
                <h1 className="text-3xl font-bold tracking-[-0.025em] text-[#102b3f]">
                  Reset your password
                </h1>
                <p className="mt-2 text-sm leading-6 text-[#667b89]">
                  Choose a new password for your secure LIVE account.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="w-full border-b border-[#dce5ea] py-5 sm:py-6">
                <div className="mx-auto mb-5 h-px w-1/2 bg-[#dce5ea] sm:mb-6" aria-hidden="true" />
                <label className="block">
                  <FieldLabel>Reset token</FieldLabel>

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
                  <FieldLabel>New password</FieldLabel>

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
                  <FieldLabel>Confirm new password</FieldLabel>

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
                  <div className="mt-4 border border-[#efc9c7] bg-[#ffefee] px-3 py-2.5 text-sm font-medium text-[#a93331]">
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
                className="mt-5 block text-center text-sm font-semibold text-[#0f6872]"
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

"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="min-h-dvh bg-[#f6f8fb]">
      <PublicHeader />

      <main className="grid min-h-dvh place-items-center px-4 pb-10 pt-24">
        <div className="w-full max-w-md p-6 sm:p-8">
          {sent ? (
            <div className="text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e8f8f0] text-[#1f845b]">
                <MailCheck className="h-6 w-6" />
              </span>

              <h1 className="mt-5 text-2xl font-bold">
                Recovery demonstration sent
              </h1>

              <p className="mt-3 text-sm leading-6 text-[#667b89]">
                No real email was sent. In
                production, an approved verification
                flow would handle account recovery.
              </p>

              <Link href="/login" className="block">
                <Button
                  type="button"
                  className="mt-6 w-full"
                >
                  Return to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSent(true);
              }}
            >
              <h1 className="text-2xl font-bold tracking-[-0.03em]">
                Recover your account
              </h1>

              <p className="mt-2 text-sm leading-6 text-[#667b89]">
                Enter your email to demonstrate the
                recovery flow.
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

              <Button
                type="submit"
                className="mt-5 w-full"
                size="lg"
              >
                Continue
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
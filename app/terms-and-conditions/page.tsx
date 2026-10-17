"use client";

import Link from "next/link";
import { useState } from "react";
import { PublicHeader } from "@/components/layout/public-header";

export default function TermsAndConditionsPage() {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-dvh bg-transparent">
      <PublicHeader />

      <main className="mx-auto max-w-3xl px-5 pb-32 pt-28 sm:px-6">
        <div className="p-1 sm:p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f6872]">
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.025em] text-[#102b3f]">
            Terms and Conditions
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#667b89]">
            Please read these terms before using LIVE.
          </p>

          <div className="mt-8 space-y-6 text-sm leading-7 text-[#425866]">
            <section>
              <h2 className="font-bold text-[#102b3f]">1. Use of LIVE</h2>
              <p className="mt-2">
                LIVE helps users share emergency information with authorised response teams. Provide accurate information and use the service responsibly.
              </p>
            </section>
            <section>
              <h2 className="font-bold text-[#102b3f]">2. Emergencies</h2>
              <p className="mt-2">
                LIVE is a support tool and does not replace official emergency numbers or guarantee that emergency services have been contacted. In an immediate emergency, contact the appropriate emergency services directly.
              </p>
            </section>
            <section>
              <h2 className="font-bold text-[#102b3f]">3. Account information</h2>
              <p className="mt-2">
                Keep your account details secure and make sure your contact and emergency-contact information stays up to date.
              </p>
            </section>
            <section>
              <h2 className="font-bold text-[#102b3f]">4. Acceptance</h2>
              <p className="mt-2">
                By creating an account or signing in, you confirm that you have read and accepted these terms.
              </p>
            </section>

            <section>
              <h2 className="font-bold text-[#102b3f]">5. Your responsibilities</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Use your own account and keep your password private.</li>
                <li>Only submit information that is accurate and relevant to the request.</li>
                <li>Do not misuse, disrupt, or attempt to gain unauthorised access to LIVE.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-bold text-[#102b3f]">6. Contact and medical information</h2>
              <p className="mt-2">
                LIVE uses the contact, emergency-contact, location, and optional medical information you provide to support an emergency request and share relevant details with authorised response teams. Keep this information accurate and provide only what is necessary.
              </p>
            </section>
          </div>

        </div>

        <footer className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center justify-center bg-[#f6f8fb]/95 px-5 py-3 text-center backdrop-blur-xl">
          <label className="flex items-center justify-center gap-3 text-sm leading-6 text-[#425866]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="h-4 w-4 accent-[#0f6872]"
            />
            <span>I have read and agree to the Terms and Conditions.</span>
          </label>

          <Link
            href="/login"
            aria-disabled={!agreed}
            onClick={(event) => {
              if (!agreed) event.preventDefault();
            }}
            className={`mt-4 text-sm font-semibold underline underline-offset-2 ${
              agreed ? "text-[#0f6872]" : "pointer-events-none text-[#9aabb5]"
            }`}
          >
            Continue to sign in
          </Link>
        </footer>
      </main>
    </div>
  );
}

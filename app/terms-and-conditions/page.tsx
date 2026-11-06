"use client";

import Link from "next/link";
import { PublicHeader } from "@/components/layout/public-header";
import { TermsDocument } from "@/components/legal/terms-document";

export default function TermsAndConditionsPage() {
  return (
    <div className="min-h-dvh bg-transparent">
      <PublicHeader />

      <main className="mx-auto max-w-3xl px-5 pb-32 pt-6 sm:px-6 sm:pt-8">
        <TermsDocument />

        <footer className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center justify-center border-t border-[#dce5ea] bg-white/95 px-5 py-3 text-center backdrop-blur-xl">
          <Link
            href="/login"
            className="text-sm font-semibold text-[#0f6872] underline underline-offset-2"
          >
            Continue to sign in
          </Link>
        </footer>
      </main>
    </div>
  );
}

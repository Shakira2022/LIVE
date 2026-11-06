"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { TermsDocument } from "@/components/legal/terms-document";

export function TermsAcceptanceSheet() {
  const { acceptTerms } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    document.getElementById("terms-document-title")?.focus();
  }, []);

  async function accept() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await acceptTerms();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to save your acceptance. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-document-title"
      className="fixed inset-0 z-[120] overflow-y-auto bg-[#f6f8fb] text-[#102b3f]"
    >
      <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 pb-36 pt-6 sm:px-6 sm:pt-8">
        <TermsDocument />
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-[#dce5ea] bg-[#f6f8fb]/95 px-5 py-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 sm:px-4">
          {error ? <p role="alert" className="text-center text-sm text-[#a33a38]">{error}</p> : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void accept()}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f6872] px-5 text-sm font-bold text-white shadow-md transition hover:bg-[#0c5962] disabled:cursor-wait disabled:opacity-60 sm:max-w-sm"
          >
            {saving ? <><LoaderCircle className="h-4 w-4 animate-spin" />Saving acceptance...</> : "I accept the Terms and Conditions"}
          </button>
        </div>
      </footer>
    </div>
  );
}

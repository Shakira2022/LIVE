"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { MOCK_CREDENTIALS } from "@/lib/mock-data";
import { roleLabel } from "@/lib/utils";

export function DemoAccountPicker({
  onPick,
}: {
  onPick: (email: string, password: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-between rounded-xl border border-[#d7e0e7] bg-[#f8fafb] px-4 text-left transition hover:border-[#a9bbc6]"
      >
        <span className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-[#0f6872]" />
          <span>
            <span className="block text-sm font-semibold">Use a demo account</span>
            <span className="block text-xs text-[#72848f]">
              Requester, dispatcher, responder, admin or auditor
            </span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Choose a demo workspace"
        description="Select an account to fill the login form. The workspace opens only after you press Sign in."
      >
        <div className="grid gap-2 p-4 sm:p-5">
          {MOCK_CREDENTIALS.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => {
                onPick(account.email, account.password);
                setOpen(false);
              }}
              className="flex items-center gap-3 rounded-2xl border border-[#dfe7ec] bg-white p-4 text-left transition hover:border-[#9eb4c1] hover:bg-[#f8fafb]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#102b3f] text-xs font-semibold text-white">
                {account.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{account.name}</span>
                <span className="block truncate text-xs text-[#6e818e]">{account.email}</span>
              </span>
              <span className="rounded-full bg-[#e7f3f4] px-2.5 py-1 text-[10px] font-semibold text-[#0f6872]">
                {roleLabel(account.role)}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

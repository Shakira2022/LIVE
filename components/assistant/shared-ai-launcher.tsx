"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { AiAssistantSheet } from "@/components/requester/ai-assistant-sheet";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";

const GENERAL_CONTEXT = {
  id: "",
  category: "General assistance",
  severity: "High",
  note: "",
  status: "",
  location: { address: "Location unavailable" },
  responder: null,
};

export function SharedAiLauncher() {
  const { user } = useAuth();
  const pathname = usePathname() ?? "/";
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const [open, setOpen] = useState(false);

  function openAssistant() {
    // Requester home owns its active-request context and its persistent chat.
    if (user?.role === "requester" && pathname === "/app/requester") {
      window.dispatchEvent(new CustomEvent("live:requester-voice-action", { detail: { action: "open-ai" } }));
      return;
    }
    setOpen(true);
  }

  return <>
    {!open ? <button
      type="button"
      onClick={openAssistant}
      aria-haspopup="dialog"
      aria-label={requesterText(uiLanguage, "LIVE AI help")}
      className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-[90] inline-flex h-11 items-center gap-2 rounded-full bg-[#102b3f] px-4 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(16,43,63,.28)] transition hover:bg-[#0b2131] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/35 md:right-6 md:bottom-6"
    ><MessageCircleQuestion className="h-5 w-5" /><span>{requesterText(uiLanguage, "Ask LIVE AI")}</span></button> : null}
    <AiAssistantSheet open={open} onOpenChange={setOpen} emergency={GENERAL_CONTEXT} />
  </>;
}

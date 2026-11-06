"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { requesterText } from "@/lib/requester-ui";
import type { RequesterLanguage } from "@/lib/requester-language";

type RequesterPage = "home" | "request" | "history" | "notifications" | "settings" | "profile";

const PAGE_GUIDES: Record<RequesterPage, { label: string; intro: string; steps: string[] }> = {
  home: {
    label: "Home",
    intro: "Request urgent help or manage your current emergency from this page.",
    steps: [
      "Without an active request, choose Medical, Fire, or Police, then request the selected help.",
      "With an active request, use the numbered actions for tracking, calling the responder, cancelling, or asking LIVE AI.",
      "Your recent request activity and status appear below the map or request card.",
    ],
  },
  request: {
    label: "Request help",
    intro: "Use this form when you need to provide details for an emergency request.",
    steps: [
      "Choose the emergency category and priority, then add a short description if you can.",
      "Continue to confirm your location. You can use your current location or search for an address.",
      "Review the request details and location, then submit the request.",
    ],
  },
  history: {
    label: "History",
    intro: "Your previous and current emergency requests are listed with the newest activity first.",
    steps: [
      "Choose a request row to open its details.",
      "With voice commands on, say “open option one” or “click button one” to open the first listed request.",
      "Say “close” or “click close” to close the request details sheet.",
    ],
  },
  notifications: {
    label: "Notifications",
    intro: "Request status updates and call notifications are listed here, with unread items marked.",
    steps: [
      "Choose a notification to open its linked request or call details. Say “open option one” to open the first item.",
      "Use “Mark all read” to clear the unread markers, or say “read notifications” to hear them aloud.",
      "Say “open notification” to open the latest unread notification, or the latest notification if none are unread.",
    ],
  },
  settings: {
    label: "Settings",
    intro: "Adjust how LIVE looks and works on this device.",
    steps: [
      "Use System settings to choose your language, appearance, and voice guidance preferences.",
      "Use Request settings to review preferences that affect emergency requests.",
      "Use Profile to review or update your contact and emergency details. Changes are saved from the profile editor.",
      "Open Accessibility in the top bar for text size, brightness, motion, and notification sound controls.",
    ],
  },
  profile: {
    label: "Profile",
    intro: "Keep your contact and emergency information current so responders can reach and assist you.",
    steps: [
      "Choose Edit profile to update your name and callback number.",
      "Use Emergency & medical in the editor to update your emergency contact and optional medical details.",
      "Choose Save profile to keep your changes, or Cancel to close without saving.",
      "Email addresses cannot be changed here. For voice entry, say ‘spell name’ or ‘spell surname’ before speaking the name or letters.",
    ],
  },
};

export function RequesterPageHelpButton({ page, language }: { page: RequesterPage; language: RequesterLanguage }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const guide = PAGE_GUIDES[page];
  const title = requesterText(language, "How to use {page}", { page: requesterText(language, guide.label) });

  useEffect(() => {
    const handleVoiceAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action !== "page-help" || !buttonRef.current?.getClientRects().length) return;
      setOpen(true);
    };
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    return () => window.removeEventListener("live:requester-voice-action", handleVoiceAction);
  }, []);

  return <>
    <Button
      ref={buttonRef}
      data-live-page-help-trigger="true"
      type="button"
      variant="ghost"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="border-0 bg-transparent text-[#0f6872] shadow-none hover:border-0 hover:bg-transparent hover:text-[#0f5b67]"
    >
      <CircleHelp className="h-4 w-4" />
      {requesterText(language, "Help")}
    </Button>
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={requesterText(language, guide.intro)}
      side="right"
    >
      <div className="grid gap-5 px-5 py-4 sm:px-6">
        <ol className="grid gap-3">
          {guide.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-[#526a78]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-xs font-bold text-[#0f6872]">{index + 1}</span>
            <span>{requesterText(language, step)}</span>
          </li>)}
        </ol>
        <section className="rounded-xl border border-[#dce5ea] bg-[#f6f8fb] p-4">
          <h3 className="text-sm font-semibold text-[#102b3f]">{requesterText(language, "Voice navigation")}</h3>
          <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#526a78]">
            <li>{requesterText(language, "Say “navigation” to show Home, Request help, History, and Notifications, then say a tab name or choose an option.")}</li>
            <li>{requesterText(language, "Say “go to Request help” or “open Request help page” to open the full request form.")}</li>
            <li>{requesterText(language, "Say “page help” or “how do I use this page” to open these instructions. In a sheet, say “next option”, “previous option”, “select”, or “click close”.")}</li>
          </ul>
        </section>
      </div>
    </Sheet>
  </>;
}

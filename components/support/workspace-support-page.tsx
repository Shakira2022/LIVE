"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { PageHeading } from "@/components/ui/page-heading";
import { SupportContactForm } from "@/components/support/support-contact-form";
import { useRequesterLanguage } from "@/lib/requester-ui";
import { supportText } from "@/lib/support-ui";

export function WorkspaceSupportPage() {
  const { user } = useAuth();
  const languageUserId = user && (user.role === "requester" || user.role === "responder") ? user.id : "";
  const usesRequesterLanguage = Boolean(languageUserId);
  const language = useRequesterLanguage(languageUserId);
  const t = (text: string) => usesRequesterLanguage ? supportText(language, text) : text;

  return <div className="mx-auto max-w-3xl px-5 py-7 sm:px-6 sm:py-10"><PageHeading title={t("Contact support")} description={t("Choose what you need help with and tell us what happened.")} /><SupportContactForm workspace language={language} /></div>;
}

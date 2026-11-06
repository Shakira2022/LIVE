"use client";

import { DisplayThemeSettings } from "@/components/settings/display-theme-settings";
import { PageHeading } from "@/components/ui/page-heading";

export default function ManagerSettingsPage() {
  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Manager"
        title="Settings"
        description="Choose how LIVE appears for your account."
      />
      <DisplayThemeSettings description="Your appearance preference is saved to your account and used across LIVE." />
    </div>
  );
}

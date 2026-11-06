"use client";

import { PageHeading } from "@/components/ui/page-heading";
import { StaffProfileCard } from "@/components/profile/staff-profile-card";

export default function ManagerProfilePage() {
  return (
    <div className="app-page">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <PageHeading
          eyebrow="Manager profile"
          title="Your profile"
          description="Your account details and management access."
        />
        <StaffProfileCard />
      </div>
    </div>
  );
}

"use client";

import { HeartPulse, LogOut, Mail, Phone, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Button } from "@/components/ui/button";

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 px-5 py-4 sm:px-6">
      <span className="mt-0.5 shrink-0 text-[#0f6872]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">{label}</p>
        <p className="mt-1 break-words text-sm font-medium text-[#102b3f]">{value}</p>
      </div>
    </div>
  );
}

function MedicalField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="grid gap-1 text-sm">
      <p className="font-semibold text-[#102b3f]">{label}</p>
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
          placeholder={`Add ${label.toLowerCase()}`}
          rows={2}
          className="resize-none border-0 border-b border-[#aebfc9] bg-transparent px-0 py-2 text-sm text-[#102b3f] outline-none focus:border-b-2 focus:border-[#0f5b67]"
        />
      ) : (
        <div className="flex items-center justify-between gap-2 border-b border-[#dce5ea] py-2">
          <p className="min-w-0 truncate text-[#667b89]">{value || "Not provided"}</p>
          {value ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 text-xs font-semibold text-[#0f6872] underline underline-offset-2"
            >
              Edit
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function RequesterProfileContent() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [medicalDetails, setMedicalDetails] = useState({
    conditions: "",
    allergies: "",
    medications: "",
  });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("live-medical-details-v1");
      if (saved) setMedicalDetails((current) => ({ ...current, ...JSON.parse(saved) }));
    } catch {
      // Local profile details are optional and must not block the profile page.
    }
  }, []);

  function updateMedicalDetail(field: keyof typeof medicalDetails, value: string) {
    setMedicalDetails((current) => {
      const next = { ...current, [field]: value };
      window.localStorage.setItem("live-medical-details-v1", JSON.stringify(next));
      return next;
    });
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    window.dispatchEvent(new Event("live:logout-start"));
    await logout();
    router.replace("/login");
  }

  if (!user) return null;

  const userAddress =
    "address" in user && typeof user.address === "string" && user.address.trim()
      ? user.address
      : "Address not provided";

  return (
    <div className="grid gap-5">
      <PageHeading
        title={<span className="hidden sm:inline">Emergency profile</span>}
        description="The contact details below are included automatically with a request, so you do not need to re-enter them in an emergency."
        descriptionClassName="hidden sm:block"
        action={
          <Button variant="primary" disabled={loggingOut} onClick={() => void handleLogout()} className="hidden md:inline-flex">
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Logging out..." : "Logout"}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr]">
        <Panel className="border-0 bg-transparent lg:border-x lg:bg-white">
          <div className="relative flex items-center gap-0 px-4 py-5 text-left sm:block sm:px-6 sm:py-6 sm:text-center">
            <div className="relative -ml-2 flex w-2/5 shrink-0 justify-center after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-gradient-to-b after:from-transparent after:via-[#102b3f] after:to-transparent sm:ml-0 sm:block sm:w-auto sm:after:hidden">
              <span className="grid h-28 w-28 place-items-center rounded-full bg-[#102b3f] text-lg font-semibold text-white sm:mx-auto sm:h-16 sm:w-16">{user.initials}</span>
            </div>
            <div className="box-border min-w-0 w-3/5 pl-3 sm:w-auto sm:pl-0">
              <h2 className="mt-0 truncate text-xl font-semibold text-[#102b3f] sm:mt-4">{user.name}</h2>
              <div className="mt-2 grid gap-1 text-sm text-[#667b89] sm:hidden">
                <p className="truncate">{user.phone || "Phone not provided"}</p>
                <p className="truncate">{user.email || "Email not provided"}</p>
                <p className="truncate">{userAddress}</p>
                <p className="truncate text-xs">ID: {user.id}</p>
              </div>
            </div>
          </div>
          <div className="hidden divide-y divide-[#e2e8ed] border-t border-[#e2e8ed] sm:block">
            <Detail icon={<Mail className="h-5 w-5" />} label="Email" value={user.email} />
            <Detail icon={<Phone className="h-5 w-5" />} label="Callback number" value={user.phone} />
          </div>
        </Panel>

        <Panel className="border-0 bg-transparent lg:border-x lg:bg-white">
          <PanelHeader title="Emergency contact" description="Used by the response team when it is appropriate to contact someone on your behalf." />
          <div className="divide-y divide-[#e2e8ed]">
            <Detail icon={<UserRound className="h-5 w-5" />} label="Contact name" value={user.emergencyContactName || "Not provided"} />
            <Detail icon={<Phone className="h-5 w-5" />} label="Contact number" value={user.emergencyContactPhone || "Not provided"} />
          </div>
        </Panel>

        <Panel className="border-0 bg-transparent lg:col-span-2 lg:border-x lg:bg-white">
          <div className="flex gap-3 border-b border-[#e2e8ed] px-5 py-4 sm:px-6">
            <HeartPulse className="mt-0.5 h-5 w-5 shrink-0 text-[#0f6872]" />
            <div>
              <h2 className="font-semibold text-[#102b3f]">Important medical details</h2>
              <p className="mt-1 text-sm text-[#667b89]">Optional details that may help responders.</p>
            </div>
          </div>
          <div className="grid gap-4 px-5 py-5 pl-16 sm:grid-cols-3 sm:px-6 sm:pl-20">
            <MedicalField label="Medical conditions" value={medicalDetails.conditions} onChange={(value) => updateMedicalDetail("conditions", value)} />
            <MedicalField label="Allergies" value={medicalDetails.allergies} onChange={(value) => updateMedicalDetail("allergies", value)} />
            <MedicalField label="Current medication" value={medicalDetails.medications} onChange={(value) => updateMedicalDetail("medications", value)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

"use client";

import {
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
} from "@/components/ui/field";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";

export default function AdminProfile() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Admin profile"
        title={user.name}
        description="Review the contact information LIVE uses automatically during emergency requests."
      />

      <div className="grid gap-5 lg:grid-cols-[0.7fr_1.3fr]">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 md:mx-0 md:rounded-[22px] md:border-x"
        >
          <div className="px-5 py-6 text-center md:p-5">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-[22px] bg-[#102b3f] text-xl font-semibold text-white">
              {user.initials}
            </span>

            <h2 className="mt-4 text-xl font-semibold">
              {user.name}
            </h2>

            <Badge tone="success" className="mt-2">
              {user.status}
            </Badge>
          </div>

          <div className="divide-y divide-[#e2e8ed] border-t border-[#e2e8ed] md:m-5 md:mt-0 md:grid md:gap-2 md:divide-y-0 md:border-0">
            <div className="flex items-center gap-3 px-5 py-4 md:rounded-xl md:bg-[#f3f6f8] md:p-3">
              <Mail className="h-5 w-5 shrink-0 text-[#0f6872]" />
              <span className="min-w-0 truncate text-sm font-medium">
                {user.email}
              </span>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 md:rounded-xl md:bg-[#f3f6f8] md:p-3">
              <Phone className="h-5 w-5 shrink-0 text-[#0f6872]" />
              <span className="text-sm font-medium">
                {user.phone}
              </span>
            </div>
          </div>
        </Panel>

        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 md:mx-0 md:rounded-[22px] md:border-x"
        >
          <PanelHeader
            title="Admin information"
            description="These details are for the admin."
            className="px-5"
          />

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 md:p-5">
            <label>
              <FieldLabel>
                Contact number
              </FieldLabel>
              <Input defaultValue={user.phone} />
            </label>

            <label>
              <FieldLabel>
                Admin contact name
              </FieldLabel>
              <Input
                defaultValue={
                  user.emergencyContactName || ""
                }
              />
            </label>

            <label>
              <FieldLabel>
                Admin email
              </FieldLabel>
              <Input
                defaultValue={
                  user.email || ""
                }
              />
            </label>

            <Button className="w-full sm:col-span-2 sm:w-auto sm:justify-self-start">
              <ShieldCheck className="h-4 w-4" />
              Save mock profile
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

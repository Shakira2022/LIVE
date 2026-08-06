"use client";
import { Building2, DatabaseZap, MapPin, Phone, Power } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
export default function AdminOrgs(){const{user}=useAuth();const{db,loading,toggleOrganisationStatus}=useMockStore();if(loading||!db||!user)return <PageSkeleton/>;return <div className="app-page grid gap-5"><PageHeading eyebrow="Administration" title="Response organisations" description="Review service coverage, integration state and operational availability."/><div className="grid gap-4 lg:grid-cols-2">{db.organisations.map(org=><Panel key={org.id}><PanelHeader title={org.name} description={org.type} action={<Badge tone={org.status==="Active"?"success":"warning"}>{org.status}</Badge>}/><div className="divide-y divide-[#e2e8ed]">{[[DatabaseZap,"Integration",org.integration],[MapPin,"Service area",org.serviceArea],[Phone,"Operational contact",org.phone]].map(([Icon,label,value])=>{const I=Icon as typeof Building2;return <div key={String(label)} className="flex gap-3 p-4 sm:p-5"><I className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">{String(label)}</p><p className="mt-1 font-semibold">{String(value)}</p></div></div>})}</div><div className="border-t border-[#e2e8ed] p-4"><Button variant={org.status==="Active"?"outline":"success"} className="w-full" onClick={()=>toggleOrganisationStatus(org.id,user)}><Power className="h-4 w-4"/>{org.status==="Active"?"Pause organisation":"Restore organisation"}</Button></div></Panel>)}</div></div>}

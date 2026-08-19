"use client";
import { Ambulance, Building2, Mail, Phone, Radio } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
export default function ResponderProfile(){const{user}=useAuth();const{db,loading}=useMockStore();if(loading||!db||!user)return <PageSkeleton/>;const responder=db.responders.find(r=>r.userId===user.id) ??
  (user.role==="responder" && user.email==="responder@live.co.za"
    ? db.responders.find(r=>r.id==="rsp-001")
    : undefined);const org=db.organisations.find(o=>o.id===responder?.organisationId);return <div className="app-page grid gap-5"><PageHeading eyebrow="Responder profile" title={user.name} description="Mock operational identity, roster and vehicle details."/><div className="grid gap-4 lg:grid-cols-[.65fr_1.35fr]"><Panel><div className="p-5 text-center"><span className="mx-auto grid h-20 w-20 place-items-center rounded-[24px] bg-[#102b3f] text-xl font-bold text-white">{user.initials}</span><h2 className="mt-4 text-xl font-bold">{user.name}</h2><Badge className="mt-2" tone={responder?.availability==="Available"?"success":responder?.availability==="Assigned"?"warning":"slate"}>{responder?.availability||"Unavailable"}</Badge></div></Panel><Panel><PanelHeader title="Operational profile"/><div className="grid sm:grid-cols-2">{[[Mail,"Email",user.email],[Phone,"Phone",user.phone],[Ambulance,"Team and vehicle",`${responder?.team||"—"} · ${responder?.vehicle||"—"}`],[Building2,"Organisation",org?.name||"—"],[Radio,"Roster state",responder?.availability||"—"]].map(([Icon,label,value],index)=>{const I=Icon as typeof Mail;return <div key={String(label)} className={`flex gap-3 p-4 sm:p-5 ${index<4?"border-b border-[#e2e8ed]":""} ${index%2===0?"sm:border-r":""}`}><I className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">{String(label)}</p><p className="mt-1 font-semibold">{String(value)}</p></div></div>})}</div></Panel></div></div>}

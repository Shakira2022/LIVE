"use client";
import { Eye, Mail, Phone, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
export default function AuditorProfile(){const{user}=useAuth();if(!user)return null;return <div className="app-page grid gap-5"><PageHeading eyebrow="Auditor profile" title={user.name} description="Read-only support and audit identity."/><Panel><PanelHeader title="Access profile" action={<Badge tone="brand">Read only</Badge>}/><div className="grid sm:grid-cols-2">{[[Mail,"Email",user.email],[Phone,"Phone",user.phone],[ShieldCheck,"Role","Support / Auditor"],[Eye,"Permission","Approved incident and audit records"]].map(([Icon,label,value],index)=>{const I=Icon as typeof Mail;return <div key={String(label)} className={`flex gap-3 p-4 sm:p-5 ${index<2?"border-b border-[#e2e8ed]":""} ${index%2===0?"sm:border-r":""}`}><I className="h-5 w-5 text-[#0f5b67]"/><div><p className="text-xs font-bold uppercase tracking-wide text-[#748693]">{String(label)}</p><p className="mt-1 font-semibold">{String(value)}</p></div></div>})}</div></Panel></div>}

"use client";
import { useState } from "react";
import { MapPin, PhoneCall } from "lucide-react";
import { RequestListItem } from "@/components/requests/request-list-item";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import { requestStatusTone } from "@/lib/utils";

export default function AuditorIncidents(){
  const {db,loading}=useMockStore();
  const [openId,setOpenId]=useState<string|null>(null);
  if(loading||!db)return <PageSkeleton/>;
  const selected=db.requests.find(r=>r.id===openId);
  return <div className="app-page grid gap-5"><PageHeading eyebrow="Read-only review" title="Incident records" description="Open a record to review its location and lifecycle history."/><Panel><PanelHeader title={`${db.requests.length} records`}/>{db.requests.map(r=><RequestListItem key={r.id} request={r} onClick={()=>setOpenId(r.id)}/>)}</Panel><Sheet open={Boolean(selected)} onOpenChange={open=>{if(!open)setOpenId(null)}} title={selected?.id||"Incident"} description="Read-only incident record" side="right"><div className="p-5">{selected?<><div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-bold">{selected.category}</h3><p className="mt-1 text-sm text-[#687b89]">{selected.severity} priority</p></div><Badge tone={requestStatusTone(selected.status)}>{selected.status}</Badge></div><dl className="mt-5 divide-y divide-[#e2e8ed] border-y border-[#e2e8ed]"><div className="flex gap-3 py-4"><PhoneCall className="h-5 w-5 text-[#0f5b67]"/><div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Requester</dt><dd className="mt-1 font-semibold">{selected.requesterName}</dd><dd className="mt-1 text-sm text-[#617582]">{selected.callbackNumber}</dd></div></div><div className="flex gap-3 py-4"><MapPin className="h-5 w-5 text-[#0f5b67]"/><div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Location</dt><dd className="mt-1 font-semibold">{selected.location.address}</dd></div></div><div className="py-4"><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Incident note</dt><dd className="mt-2 text-sm leading-6">{selected.note}</dd></div></dl><h4 className="mt-6 font-semibold">Lifecycle history</h4><StatusTimeline entries={selected.statusHistory}/></>:null}</div></Sheet></div>;
}

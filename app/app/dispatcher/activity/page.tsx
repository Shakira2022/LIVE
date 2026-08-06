"use client";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import { formatDateTime } from "@/lib/utils";
export default function DispatchActivity(){const{db,loading}=useMockStore();if(loading||!db)return <PageSkeleton/>;const logs=db.auditLogs.filter(l=>["dispatcher","responder","system"].includes(l.actorRole));return <div className="app-page grid gap-5"><PageHeading eyebrow="Dispatch" title="Operational activity" description="Recent status changes, assignments and routing actions."/><Panel><PanelHeader title={`${logs.length} activity events`}/><div className="divide-y divide-[#e2e8ed]">{logs.map(log=><article key={log.id} className="flex gap-3 p-4 sm:p-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3f5] text-[#0f5b67]"><Activity className="h-5 w-5"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{log.action}</h2><Badge tone={log.result==="Success"?"success":log.result==="Denied"?"danger":"warning"}>{log.result}</Badge></div><p className="mt-1 text-sm text-[#627683]">{log.actorName} · {log.target}</p><p className="mt-2 text-xs text-[#87959e]">{formatDateTime(log.timestamp)} · {log.correlationId}</p></div></article>)}</div></Panel></div>}

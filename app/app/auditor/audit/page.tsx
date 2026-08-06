"use client";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import { formatDateTime } from "@/lib/utils";
export default function AuditorAudit(){const{db,loading}=useMockStore();if(loading||!db)return <PageSkeleton/>;return <div className="app-page grid gap-5"><PageHeading eyebrow="Read-only review" title="Audit logs" description="Approved security and operational events. No modification controls are available."/><Panel><PanelHeader title={`${db.auditLogs.length} events`}/><div className="divide-y divide-[#e2e8ed]">{db.auditLogs.map(log=><article key={log.id} className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{log.action}</h2><p className="mt-1 text-sm text-[#617582]">{log.actorName} · {log.actorRole} · {log.target}</p><p className="mt-2 text-xs text-[#87959e]">{formatDateTime(log.timestamp)} · {log.correlationId}</p></div><Badge tone={log.result==="Success"?"success":log.result==="Denied"?"danger":"warning"}>{log.result}</Badge></div></article>)}</div></Panel></div>}

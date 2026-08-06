"use client";
import Link from "next/link";
import { ArrowRight, FileSearch, ShieldCheck, Siren } from "lucide-react";
import { Metric } from "@/components/dashboard/metric";
import { RequestListItem } from "@/components/requests/request-list-item";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
export default function AuditorHome(){const{db,loading}=useMockStore();if(loading||!db)return <PageSkeleton/>;return <div className="app-page grid gap-5"><PageHeading eyebrow="Read-only review" title="Audit and incident overview" description="Review approved mock incident records without operational modification controls."/><div className="grid gap-3 sm:grid-cols-3"><Metric label="Incident records" value={db.requests.length} icon={<Siren className="h-5 w-5"/>}/><Metric label="Audit events" value={db.auditLogs.length} icon={<ShieldCheck className="h-5 w-5"/>}/><Metric label="Organisations" value={db.organisations.length} icon={<FileSearch className="h-5 w-5"/>}/></div><Panel><PanelHeader title="Recent incidents" action={<Link href="/app/auditor/incidents"><Button variant="ghost" size="sm">View all<ArrowRight className="h-4 w-4"/></Button></Link>}/>{db.requests.slice(0,6).map(r=><RequestListItem key={r.id} request={r} href={`/app/auditor/incidents?request=${encodeURIComponent(r.id)}`} compact/>)}</Panel></div>}

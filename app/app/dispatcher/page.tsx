"use client";
import Link from "next/link";
import { Ambulance, ArrowRight, CircleAlert, Radio, Users } from "lucide-react";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { RequestListItem } from "@/components/requests/request-list-item";
import { Metric } from "@/components/dashboard/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import { isActiveStatus } from "@/lib/utils";
export default function DispatcherDashboard(){const{db,loading}=useMockStore();if(loading||!db)return <PageSkeleton map/>;const active=db.requests.filter(r=>isActiveStatus(r.status));const unassigned=active.filter(r=>!r.assignedResponderId);const available=db.responders.filter(r=>r.availability==="Available");const critical=active.filter(r=>r.severity==="Critical");return <div className="app-page grid gap-5"><PageHeading eyebrow="Dispatch operations" title="Live response overview" description="Monitor the mock request queue, locations and response resources." action={<Badge tone="success"><span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]"/>Operations online</Badge>}/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active requests" value={active.length} detail="Across all operational states" tone="danger" icon={<Radio className="h-5 w-5"/>}/><Metric label="Awaiting assignment" value={unassigned.length} detail="Requires dispatcher attention" tone="warning" icon={<CircleAlert className="h-5 w-5"/>}/><Metric label="Available responders" value={available.length} detail="Mock roster availability" tone="success" icon={<Users className="h-5 w-5"/>}/><Metric label="Critical priority" value={critical.length} detail="Highest priority cases" tone="danger" icon={<Ambulance className="h-5 w-5"/>}/></div><div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><LiveResponseMap showAll requests={active} immersive/><Panel><PanelHeader title="Priority queue" description="Newest active requests" action={<Link href="/app/dispatcher/requests"><Button variant="ghost" size="sm">All requests<ArrowRight className="h-4 w-4"/></Button></Link>}/>{active.slice(0,5).map(r=><RequestListItem key={r.id} request={r} href={`/app/dispatcher/requests/${r.id}`} compact/>)}</Panel></div></div>}

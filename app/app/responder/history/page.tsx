"use client";
import { History } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { RequestListItem } from "@/components/requests/request-list-item";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
export default function ResponderHistory(){const{user}=useAuth();const{db,loading}=useMockStore();if(loading||!db||!user)return <PageSkeleton/>;const responder=db.responders.find(r=>r.userId===user.id) ??
  (user.role==="responder" && user.email==="responder@live.co.za"
    ? db.responders.find(r=>r.id==="rsp-001")
    : undefined);const items=responder?db.requests.filter(r=>r.assignedResponderId===responder.id):[];return <div className="app-page grid gap-5"><PageHeading eyebrow="Responder" title="Assignment history" description="Requests assigned to your mock responder profile."/><Panel><PanelHeader title={`${items.length} assignments`}/>{items.length?items.map(r=><RequestListItem key={r.id} request={r} href="/app/responder"/>):<EmptyState icon={<History className="h-6 w-6"/>} title="No assignments" description="Assigned requests will appear here."/>}</Panel></div>}

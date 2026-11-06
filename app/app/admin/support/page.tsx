"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, LifeBuoy, LoaderCircle, Mail, MessageSquareReply, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/middleware/client/api";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { useAuth } from "@/components/auth/auth-provider";
import { readFreshCache, writeFreshCache } from "@/lib/client-cache";

type TicketStatus = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
type Ticket = { id: string; requester_name: string; requester_email: string; category: string; subject: string; status: TicketStatus; created_at: string; updated_at: string };
type Message = { id: string; sender_type: "requester" | "admin"; sender_name: string; sender_email: string; body: string; email_status: string; created_at: string };
const statuses: TicketStatus[] = ["open", "in_progress", "waiting_on_user", "resolved", "closed"];
const statusLabel: Record<TicketStatus, string> = { open: "Open", in_progress: "In progress", waiting_on_user: "Waiting on user", resolved: "Resolved", closed: "Closed" };
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function AdminSupportPage() {
  const { user, loading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const cacheKey = user?.id ? `admin-support:${user.id}` : "";
  const storeTickets = useCallback((next: Ticket[]) => {
    setTickets(next);
    if (cacheKey) writeFreshCache(cacheKey, { requests: next }, 5 * 60_000);
  }, [cacheKey]);
  const refresh = useCallback(async (force = false) => {
    if (!cacheKey) { setPageLoading(false); return; }
    if (!force) {
      const cached = readFreshCache<{ requests: Ticket[] }>(cacheKey);
      if (cached) { setTickets(cached.requests); setPageLoading(false); return; }
    }
    setRefreshing(true);
    setPageError("");
    try { const result = await api<{ requests: Ticket[] }>("/api/admin/support"); storeTickets(result.requests); }
    catch (error) { setPageError(error instanceof Error ? error.message : "Unable to load support requests."); }
    finally { setPageLoading(false); setRefreshing(false); }
  }, [cacheKey, storeTickets]);
  useEffect(() => { if (!loading) void refresh(); }, [loading, refresh]);

  const filtered = useMemo(() => tickets.filter((ticket) => (filter === "all" || ticket.status === filter) && `${ticket.subject} ${ticket.requester_name} ${ticket.requester_email} ${ticket.category}`.toLowerCase().includes(query.toLowerCase())), [tickets, filter, query]);

  async function openTicket(ticket: Ticket) {
    setSelected(ticket); setMessages([]); setDetailError(""); setDetailLoading(true);
    try { const result = await api<{ request: Ticket; messages: Message[] }>(`/api/admin/support/${ticket.id}`); setSelected(result.request); setMessages(result.messages); }
    catch (error) { setDetailError(error instanceof Error ? error.message : "Unable to load this request."); }
    finally { setDetailLoading(false); }
  }

  async function changeStatus(status: TicketStatus) {
    if (!selected) return; setStatusBusy(true); setDetailError("");
    try { const result = await api<{ request: { id: string; status: TicketStatus } }>(`/api/admin/support/${selected.id}`, { method: "PATCH", body: { status } }); const next = { ...selected, status: result.request.status, updated_at: new Date().toISOString() }; setSelected(next); storeTickets(tickets.map((item) => item.id === next.id ? next : item)); }
    catch (error) { setDetailError(error instanceof Error ? error.message : "Unable to update status."); }
    finally { setStatusBusy(false); }
  }

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setReplyBusy(true); setReplyError("");
    try { await api<{ message: Message }>(`/api/admin/support/${selected.id}/reply`, { method: "POST", body: { message: replyText } }); setReplyText(""); setReplyOpen(false); await openTicket({ ...selected, status: "waiting_on_user" }); await refresh(true); }
    catch (error) { setReplyError(error instanceof Error ? error.message : "Unable to send the reply."); }
    finally { setReplyBusy(false); }
  }

  if (loading || pageLoading) return <PageSkeleton />;
  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><PageHeading eyebrow="Administration" title="Support inbox" description="Review incoming support requests and reply to users by email." /><Button variant="outline" disabled={refreshing} onClick={() => void refresh(true)}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button></div>
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#dfe7ec] p-4 sm:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71828d]" /><Input className="h-11 rounded-lg border border-[#d7e0e7] pl-10" placeholder="Search name, email or subject" value={query} onChange={(event) => setQuery(event.target.value)} /></label><Select className="h-11 w-full rounded-lg border border-[#d7e0e7] px-3 sm:w-56" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</Select></div>
      {pageError ? <p role="alert" className="m-4 rounded-lg bg-[#fff6f5] p-4 text-sm text-[#a5322e]">{pageError}</p> : null}
      {filtered.length ? <div role="region" aria-label="Support requests list" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto divide-y divide-[#e3eaee]">{filtered.map((ticket) => <article key={ticket.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-semibold text-[#102b3f]">{ticket.subject}</h2><span className="rounded-full bg-[#edf3f5] px-2.5 py-1 text-[11px] font-semibold text-[#536879]">{statusLabel[ticket.status]}</span></div><p className="mt-1 truncate text-sm text-[#536879]">{ticket.requester_name} · {ticket.requester_email}</p><p className="mt-1 text-xs text-[#71828d]">{ticket.category} · {dateLabel(ticket.updated_at)}</p></div><Button variant="outline" size="sm" onClick={() => void openTicket(ticket)} aria-label={`View ${ticket.subject}`}><Eye className="h-4 w-4" />View</Button></article>)}</div> : <div className="px-5 py-16 text-center"><LifeBuoy className="mx-auto h-8 w-8 text-[#8ca0ad]" /><h2 className="mt-3 font-semibold text-[#102b3f]">No support requests found</h2><p className="mt-1 text-sm text-[#71828d]">New messages will appear here.</p></div>}
    </Panel>

    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected?.subject || "Support request"} description="Support request details and conversation" side="right" scrollAreaClassName="pb-0" className="h-[100dvh] max-h-[100dvh] max-w-xl" footer={selected ? <Button className="w-full" onClick={() => { setReplyError(""); setReplyOpen(true); }}><MessageSquareReply className="h-4 w-4" />Reply by email</Button> : null}>
      {selected ? <div className="flex min-h-full flex-col"><div className="grid flex-1 content-start gap-5 px-5 pt-4 sm:px-6">
        <div className="border-b border-[#e0e7ec] pb-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#71828d]">From</p><p className="mt-1 font-semibold text-[#102b3f]">{selected.requester_name}</p><a className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#0f6872] underline-offset-2 hover:underline" href={`mailto:${selected.requester_email}`}><Mail className="h-3.5 w-3.5" />{selected.requester_email}</a><p className="mt-3 text-xs text-[#71828d]">{selected.category} · Submitted {dateLabel(selected.created_at)}</p></div>
        <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#71828d]">Request status</span><Select disabled={statusBusy} className="h-11 rounded-lg border border-[#d7e0e7] px-3" value={selected.status} onChange={(event) => void changeStatus(event.target.value as TicketStatus)}>{statuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</Select></label>
        {detailError ? <p role="alert" className="rounded-lg bg-[#fff6f5] p-3 text-sm text-[#a5322e]">{detailError}</p> : null}
        <div><h3 className="mb-3 text-sm font-bold text-[#102b3f]">Conversation</h3>{detailLoading ? <div className="flex items-center gap-2 py-5 text-sm text-[#71828d]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading conversation…</div> : <div role="region" aria-label="Support conversation" tabIndex={0} className="max-h-[50dvh] touch-pan-y overscroll-contain overflow-y-auto space-y-3">{messages.map((message) => <div key={message.id} className={`rounded-xl border p-4 ${message.sender_type === "admin" ? "border-[#b9dadd] bg-[#f0f8f8]" : "border-[#e0e7ec] bg-white"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#102b3f]">{message.sender_name} <span className="font-normal text-[#71828d]">· {message.sender_type === "admin" ? "LIVE Support" : "User"}</span></p><time className="text-xs text-[#71828d]">{dateLabel(message.created_at)}</time></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#425866]">{message.body}</p>{message.sender_type === "admin" ? <p className="mt-2 text-xs text-[#71828d]">Email: {message.email_status}</p> : null}</div>)}{messages.length === 0 ? <p className="text-sm text-[#71828d]">No messages in this request.</p> : null}</div>}</div>
      </div></div> : null}
    </Sheet>
    <Sheet open={replyOpen} onOpenChange={setReplyOpen} title="Reply to user" description={selected ? `Your reply will be emailed to ${selected.requester_email}.` : undefined} side="center" className="max-w-lg">
      <form onSubmit={sendReply} className="space-y-4 px-5 pt-5 sm:px-6"><label className="block"><span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-[#5d7180]">Message</span><Textarea required minLength={2} maxLength={8000} rows={8} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Write your response to the user…" /></label>{replyError ? <p role="alert" className="rounded-lg bg-[#fff6f5] p-3 text-sm text-[#a5322e]">{replyError}</p> : null}<div className="flex justify-center gap-3"><Button variant="outline" onClick={() => setReplyOpen(false)} disabled={replyBusy}>Cancel</Button><Button type="submit" disabled={replyBusy}>{replyBusy ? <><LoaderCircle className="h-4 w-4 animate-spin" />Sending…</> : "Send reply"}</Button></div></form>
    </Sheet>
  </div>;
}

"use client";
import { LogOut, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { roleLabel } from "@/lib/utils";
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, logout } = useAuth(); const router = useRouter(); if (!user) return null;
  const profileHref = `/app/${user.role}/profile`;
  return <Sheet open={open} onOpenChange={onOpenChange} title="Account" description="Your mock LIVE workspace identity" side="right"><div className="p-5 sm:p-6"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#102b3f] text-lg font-bold text-white">{user.initials}</span><div><h3 className="text-lg font-semibold">{user.name}</h3><p className="text-sm text-[#687b89]">{roleLabel(user.role)}</p></div></div><dl className="mt-6 divide-y divide-[#e2e8ed] border-y border-[#e2e8ed]"><div className="flex gap-3 py-4"><Mail className="mt-0.5 h-5 w-5 text-[#0f5b67]"/><div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Email</dt><dd className="mt-1 text-sm font-semibold">{user.email}</dd></div></div><div className="flex gap-3 py-4"><Phone className="mt-0.5 h-5 w-5 text-[#0f5b67]"/><div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Phone</dt><dd className="mt-1 text-sm font-semibold">{user.phone}</dd></div></div><div className="flex gap-3 py-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#0f5b67]"/><div><dt className="text-xs font-bold uppercase tracking-wide text-[#748693]">Status</dt><dd className="mt-1 text-sm font-semibold">{user.status}</dd></div></div></dl><div className="mt-6 grid gap-3"><Button variant="outline" onClick={() => { onOpenChange(false); router.push(profileHref); }}><UserRound className="h-4 w-4"/>Open profile</Button><Button variant="danger" onClick={() => { logout(); onOpenChange(false); router.replace("/login"); }}><LogOut className="h-4 w-4"/>Sign out</Button></div></div></Sheet>;
}

"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Menu, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { AccountSheet } from "@/components/layout/account-sheet";
import { Brand } from "@/components/layout/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import { roleNavigation } from "@/lib/routes";
import { useMockStore } from "@/lib/mock-store";
import { cn, roleHome, roleLabel } from "@/lib/utils";

function activeFor(pathname: string, href: string) { return pathname === href || (href.split("/").length > 3 && pathname.startsWith(href + "/")); }

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth(); const { db } = useMockStore(); const pathname = usePathname(); const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false); const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  const nav = user ? roleNavigation[user.role] : [];
  useEffect(() => { if (user && !pathname.startsWith(`/app/${user.role}`)) router.replace(roleHome(user.role)); }, [user, pathname, router]);
  const unread = useMemo(() => user && db ? db.notifications.filter(n => n.userId === user.id && !n.read).length : 0, [db, user]);
  if (loading || !user) return <PageSkeleton />;
  const mobilePrimary = nav.slice(0, 4); const moreItems = nav.slice(4);
  return <div className="min-h-dvh bg-[#f6f8fb]">
    <header className="sticky top-0 z-40 border-b border-[#dfe7ec] bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        <Brand compact href={roleHome(user.role)} />
        <nav className="no-scrollbar hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex" aria-label="Workspace navigation">
          {nav.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); return <Link key={item.href} href={item.href} className={cn("inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold transition", active ? "bg-[#e7f3f4] text-[#0f5b67]" : "text-[#617582] hover:bg-[#f1f5f7] hover:text-[#102b3f]")}><Icon className="h-4 w-4" />{item.label}</Link>; })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAccountOpen(true)} className="flex h-10 items-center gap-2 rounded-xl p-1.5 pr-2 transition hover:bg-[#eef3f5]" aria-label="Open account"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#102b3f] text-[10px] font-bold text-white">{user.initials}</span><span className="hidden text-left lg:block"><span className="block max-w-32 truncate text-xs font-semibold">{user.name}</span><span className="block text-[10px] text-[#758792]">{roleLabel(user.role)}</span></span></button>
        </div>
      </div>
    </header>
    <AnimatePresence mode="wait" initial={false}><motion.main key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .18 }} className="min-h-[calc(100dvh-4rem)]">{children}</motion.main></AnimatePresence>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-[#dce5ea] bg-white/94 px-2 pt-1.5 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
      <div className="mx-auto grid max-w-md gap-1" style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}>{mobilePrimary.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); return <Link key={item.href} href={item.href} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition", active ? "text-[#0f5b67]" : "text-[#71828d]")}>{item.primary ? <span className={cn("grid h-10 w-10 place-items-center rounded-2xl text-white shadow-lg transition", active ? "bg-[#bf3533]" : "bg-[#d53f3d]")}><Icon className="h-5 w-5" /></span> : <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />}<span>{item.mobileLabel || item.label}</span>{active && !item.primary ? <span className="absolute top-0 h-0.5 w-7 rounded-full bg-[#0f5b67]" /> : null}</Link>; })}<button onClick={() => setMoreOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold text-[#71828d]"><MoreHorizontal className="h-5 w-5" /><span>More</span></button></div>
    </nav>
    <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="Workspace" description={`${roleLabel(user.role)} tools`}><div className="grid gap-2 p-4">{moreItems.length ? moreItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#dfe7ec] px-4 font-bold"><Icon className="h-5 w-5 text-[#0f5b67]" />{item.label}</Link>; }) : null}<button onClick={() => { setMoreOpen(false); setAccountOpen(true); }} className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#dfe7ec] px-4 text-left font-bold"><Menu className="h-5 w-5 text-[#0f5b67]" />Account and profile</button><div className="mt-2 rounded-2xl bg-[#f1f5f7] p-4"><div className="flex items-center justify-between"><div><p className="font-semibold">{user.name}</p><p className="text-sm text-[#6b7e8b]">{user.email}</p></div><Badge tone="brand">{roleLabel(user.role)}</Badge></div></div></div></Sheet>
    <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
  </div>;
}

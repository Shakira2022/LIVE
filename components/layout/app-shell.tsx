"use client";
import { LoaderCircle, LogOut, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import { roleNavigation } from "@/lib/routes";
import { cn, roleHome, roleLabel } from "@/lib/utils";

function activeFor(pathname: string, href: string) { return pathname === href || (href.split("/").length > 3 && pathname.startsWith(href + "/")); }

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth(); const pathname = usePathname(); const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [externalLoggingOut, setExternalLoggingOut] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const navigationDisabled = loggingOut || externalLoggingOut;
  async function handleLogout() { if (navigationDisabled) return; setLoggingOut(true); await logout(); router.replace("/login"); }
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  const nav = user ? roleNavigation[user.role] : [];
  useEffect(() => {
    if (!user) return;
    nav.forEach((item) => router.prefetch(item.href));
  }, [nav, router, user]);
  useEffect(() => {
    const onLogoutStart = () => setExternalLoggingOut(true);
    window.addEventListener("live:logout-start", onLogoutStart);
    return () => window.removeEventListener("live:logout-start", onLogoutStart);
  }, []);
  useEffect(() => { if (user && !pathname.startsWith(`/app/${user.role}`)) router.replace(roleHome(user.role)); }, [user, pathname, router]);
  useEffect(() => {
    if (!accountOpen) return;
    function closeAccountMenu(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    document.addEventListener("mousedown", closeAccountMenu);
    return () => document.removeEventListener("mousedown", closeAccountMenu);
  }, [accountOpen]);
  if (loading || !user) return <PageSkeleton />;
  const mobilePrimary = nav.slice(0, 4); const moreItems = nav.slice(4);
  return <div className={cn("min-h-dvh bg-[#f6f8fb]", navigationDisabled && "cursor-wait")}>
    <header className="sticky top-0 z-40 border-b border-[#dfe7ec] bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        <nav className="no-scrollbar hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto md:flex" aria-label="Workspace navigation">
          {nav.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) event.preventDefault(); }} className={cn("inline-flex h-16 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition", active ? "border-[#0f5b67] text-[#0f5b67]" : "border-transparent text-[#617582] hover:border-[#b8c9d0] hover:text-[#102b3f]", navigationDisabled && "pointer-events-none opacity-60")}><Icon className="h-4 w-4" />{item.label}</Link>; })}
        </nav>
        <div ref={accountMenuRef} className="relative ml-auto flex items-center gap-2">
          <button disabled={navigationDisabled} onClick={() => setAccountOpen((open) => !open)} className="flex h-10 items-center gap-2 border-b-2 border-transparent p-1.5 pr-2 transition hover:border-[#b8c9d0] disabled:pointer-events-none disabled:opacity-60" aria-label="Open account menu" aria-expanded={accountOpen}>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#102b3f] text-[10px] font-bold text-white">{user.initials}</span>
            <span className="hidden text-left lg:block"><span className="block max-w-32 truncate text-xs font-semibold">{user.name}</span><span className="block text-[10px] text-[#758792]">{roleLabel(user.role)}</span></span>
          </button>
          {accountOpen ? <div className="absolute right-0 top-full z-50 mt-1 min-w-32 rounded-lg border border-[#dfe7ec] bg-white p-1 shadow-lg" role="menu">
            <button disabled={navigationDisabled} onClick={() => void handleLogout()} className="flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:cursor-wait disabled:opacity-60" role="menuitem">
              {loggingOut ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#0f5b67]" /> : <LogOut className="h-3.5 w-3.5 text-[#0f5b67]" />}{loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div> : null}
        </div>
      </div>
    </header>
    <main className={cn("min-h-[calc(100dvh-4rem)]", navigationDisabled && "pointer-events-none select-none opacity-70")} aria-busy={navigationDisabled}>{children}</main>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-[#dce5ea] bg-white/94 px-2 pt-1.5 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
      <div className={cn("mx-auto grid max-w-md gap-1", navigationDisabled && "pointer-events-none opacity-60")} style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}>{mobilePrimary.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition", active ? "text-[#0f5b67]" : "text-[#71828d]")}>{item.primary ? <span className={cn("grid h-10 w-10 place-items-center rounded-full text-white transition", active ? "bg-[#bf3533]" : "bg-[#d53f3d]")}><Icon className="h-5 w-5" /></span> : <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />}<span>{item.mobileLabel || item.label}</span>{active && !item.primary ? <span className="absolute top-0 h-0.5 w-7 bg-[#0f5b67]" /> : null}</Link>; })}<button disabled={navigationDisabled} onClick={() => setMoreOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold text-[#71828d] disabled:cursor-wait"><MoreHorizontal className="h-5 w-5" /><span>More</span></button></div>
    </nav>
    <Sheet open={moreOpen} onOpenChange={(open) => { if (!navigationDisabled) setMoreOpen(open); }} dismissible={!navigationDisabled} title="More" showTitle={false} className="rounded-t-[16px]"><div className="divide-y divide-[#dfe7ec] border-y border-[#dfe7ec]">{moreItems.length ? moreItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) { event.preventDefault(); return; } setMoreOpen(false); }} className={cn("flex min-h-14 items-center gap-3 px-5 font-semibold", navigationDisabled && "pointer-events-none opacity-60") }><Icon className="h-5 w-5 text-[#0f5b67]" />{item.label}</Link>; }) : null}<button disabled={navigationDisabled} onClick={() => void handleLogout()} className="flex min-h-14 w-full items-center gap-3 px-5 text-left font-semibold disabled:cursor-wait disabled:opacity-60">{loggingOut ? <LoaderCircle className="h-5 w-5 animate-spin text-[#0f5b67]" /> : <LogOut className="h-5 w-5 text-[#0f5b67]" />}{loggingOut ? "Logging out..." : "Logout"}</button></div></Sheet>
  </div>;
}

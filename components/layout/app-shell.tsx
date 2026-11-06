"use client";
import { CircleHelp, Headphones, LoaderCircle, LogOut, MoreHorizontal, PhoneCall, Settings, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useAuth } from "@/components/auth/auth-provider";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { roleNavigation } from "@/lib/routes";
import { cn, roleHome, roleLabel } from "@/lib/utils";
import { CallProvider } from "@/components/calls/call-provider";
import { DispatcherPeerCallButton } from "@/components/calls/dispatcher-peer-call-button";
import { AreaDispatchCallButton } from "@/components/calls/area-dispatch-call-button";
import { AccessibilityPreferences } from "@/components/layout/accessibility-preferences";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { RequesterVoiceCommands } from "@/components/requester/requester-voice-commands";
import { BlindRequesterAnnouncements } from "@/components/requester/blind-requester-announcements";
import { loadRequesterPreferences, setActiveRequesterPreferenceUser } from "@/lib/requester-preferences";
import { Brand } from "@/components/layout/brand";
import { hasAcceptedCurrentTerms } from "@/lib/legal-terms";
import { TermsAcceptanceSheet } from "@/components/legal/terms-acceptance-sheet";
import { SettingsSetupSheet } from "@/components/legal/settings-setup-sheet";
import { RequesterHelpSheet } from "@/components/requester/requester-help-sheet";
import { RequesterCancellationNoticeAlert } from "@/components/requester/cancellation-notice-alert";
import { ResponderHelpSheet } from "@/components/responder/responder-help-sheet";
import { ResponderCancellationApprovedAlert } from "@/components/responder/cancellation-approved-alert";
import { RoleHelpSheet, type RoleHelpActor } from "@/components/help/role-help-sheet";
import { SharedAiLauncher } from "@/components/assistant/shared-ai-launcher";

function activeFor(pathname: string, href: string) {
  const path = href.split("?")[0];
  return pathname === path || (path.split("/").length > 3 && pathname.startsWith(path + "/"));
}

function hasUnreadForNavigation(role: string, href: string, unreadCount: number) {
  if (!unreadCount) return false;
  if (role === "admin") return href === "/app/admin/reports";
  return (role === "requester" || role === "dispatcher") && href === `/app/${role}/notifications`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth(); const pathname = usePathname(); const router = useRouter();
  const uiLanguage = useRequesterLanguage(user?.role === "requester" ? user.id : "");
  const [accountOpen, setAccountOpen] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [externalLoggingOut, setExternalLoggingOut] = useState(false);
  const [requesterHelpOpen, setRequesterHelpOpen] = useState(false);
  const [responderHelpOpen, setResponderHelpOpen] = useState(false);
  const [roleHelpActor, setRoleHelpActor] = useState<RoleHelpActor | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [languageChanging, setLanguageChanging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const logoutCancelRef = useRef<HTMLButtonElement>(null);
  const [accountMenuPosition, setAccountMenuPosition] = useState({ top: 64, right: 16 });
  const navigationDisabled = loggingOut || externalLoggingOut;
  const termsRequired = user?.role === "requester" || user?.role === "responder";
  const termsAccepted = user ? (!termsRequired || hasAcceptedCurrentTerms(user)) : false;
  const setupRequired = user?.role === "requester";
  const setupComplete = user ? (!setupRequired || Boolean(user.settingsSetupCompletedAt)) : false;
  useEffect(() => {
    setActiveRequesterPreferenceUser(user?.role === "requester" ? user.id : null);
    if (user?.role !== "requester") return;
    let cancelled = false;
    void loadRequesterPreferences(user.id).then(() => {
      if (cancelled) return;
      window.dispatchEvent(new Event("live:requester-preferences-changed"));
    }).catch(() => {
      // Keep this account's local preferences and defaults when offline.
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const virtualKeyboard = (navigator as Navigator & {
      virtualKeyboard?: {
        boundingRect: DOMRect;
        addEventListener?: (type: "geometrychange", listener: () => void) => void;
        removeEventListener?: (type: "geometrychange", listener: () => void) => void;
      };
    }).virtualKeyboard;
    const isMobile = window.matchMedia("(max-width: 767px)");
    let baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);

    const updateKeyboardVisibility = () => {
      if (!isMobile.matches) {
        setMobileKeyboardOpen(false);
        baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
        return;
      }

      const visibleHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const reportedKeyboardHeight = virtualKeyboard?.boundingRect.height ?? 0;
      const keyboardOpen = reportedKeyboardHeight >= 80 || baselineHeight - visibleHeight >= 150;
      setMobileKeyboardOpen(keyboardOpen);
      if (!keyboardOpen) baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
    };

    const resetForOrientationChange = () => {
      baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
      setMobileKeyboardOpen(false);
    };

    updateKeyboardVisibility();
    viewport?.addEventListener("resize", updateKeyboardVisibility);
    window.addEventListener("resize", updateKeyboardVisibility);
    isMobile.addEventListener("change", updateKeyboardVisibility);
    virtualKeyboard?.addEventListener?.("geometrychange", updateKeyboardVisibility);
    window.screen.orientation?.addEventListener("change", resetForOrientationChange);

    return () => {
      viewport?.removeEventListener("resize", updateKeyboardVisibility);
      window.removeEventListener("resize", updateKeyboardVisibility);
      isMobile.removeEventListener("change", updateKeyboardVisibility);
      virtualKeyboard?.removeEventListener?.("geometrychange", updateKeyboardVisibility);
      window.screen.orientation?.removeEventListener("change", resetForOrientationChange);
    };
  }, []);
  async function finishLogout() {
    if (navigationDisabled) return;
    setLogoutConfirmOpen(false);
    setAccountOpen(false);
    setLoggingOut(true);
    await logout();
    router.replace("/login");
  }
  function handleLogout() {
    if (navigationDisabled) return;
    setAccountOpen(false);
    if (document.body.dataset.liveCallActive === "true") {
      setLogoutConfirmOpen(true);
      return;
    }
    void finishLogout();
  }
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    const key = `live-hci-preferences:${user.id}`;
    try {
      const preferences = window.localStorage.getItem(key);
      setReducedMotion(preferences ? Boolean(JSON.parse(preferences).reducedMotion) : false);
    } catch {
      setReducedMotion(false);
    }
    const updateMotionPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ reducedMotion?: boolean }>).detail;
      if (typeof detail?.reducedMotion === "boolean") setReducedMotion(detail.reducedMotion);
    };
    window.addEventListener("live:reduced-motion-changed", updateMotionPreference);
    return () => window.removeEventListener("live:reduced-motion-changed", updateMotionPreference);
  }, [user?.id]);
  useEffect(() => {
    if (!user || !termsAccepted || !setupComplete) {
      setUnreadNotificationCount(0);
      return;
    }
    let cancelled = false;
    const fetchUnreadCount = async () => {
      try {
        const request = () => fetch("/api/notifications/unread-count", {
          cache: "no-store",
          credentials: "include",
        });
        let response = await request();
        if (response.status === 401) {
          const refreshResponse = await fetch("/api/auth/refresh", {
            method: "POST",
            cache: "no-store",
            credentials: "include",
          });
          if (refreshResponse.ok) response = await request();
        }
        if (!response.ok) return;
        const payload = await response.json() as { data?: { unreadCount?: number }; unreadCount?: number };
        const count = payload.data?.unreadCount ?? payload.unreadCount ?? 0;
        if (!cancelled) setUnreadNotificationCount(typeof count === "number" ? count : 0);
      } catch {
        // Notification polling is best effort and must not block navigation.
      }
    };
    void fetchUnreadCount();
    const timer = window.setInterval(() => void fetchUnreadCount(), 5_000);
    const refreshAfterNotificationRead = () => { void fetchUnreadCount(); };
    window.addEventListener("live:notifications-changed", refreshAfterNotificationRead);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("live:notifications-changed", refreshAfterNotificationRead);
    };
  }, [user, termsAccepted, setupComplete]);
  const nav = user ? roleNavigation[user.role].map((item) => user.role === "requester" ? {
    ...item,
    label: requesterText(uiLanguage, item.label),
    mobileLabel: item.mobileLabel ? requesterText(uiLanguage, item.mobileLabel) : undefined,
  } : item) : [];
  useEffect(() => {
    if (!user?.id || !termsAccepted || !setupComplete || (user.role !== "requester" && user.role !== "responder" && user.role !== "dispatcher")) return;

    let cancelled = false;
    const warm = async (key: string, url: string, select: (payload: any) => unknown) => {
      if (readCached(key)) return;
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const value = select(payload);
        if (!cancelled && value !== undefined && value !== null) writeFreshCache(key, value, 5 * 60_000);
      } catch {
        // The page can still fetch its own data if this best-effort warmup fails.
      }
    };

    const tasks = user.role === "requester"
      ? [
          warm(`requester-history:${user.id}`, "/api/requests?limit=100&offset=0", (payload) => payload?.data?.items ?? payload?.items ?? payload?.requests ?? []),
          warm(`requester-notifications:${user.id}`, "/api/notifications", (payload) => payload?.data?.notifications ?? payload?.notifications ?? []),
        ]
      : user.role === "responder"
        ? [
          warm(`responder-mission:${user.id}`, "/api/responder/mission", (payload) => {
            const data = payload?.data ?? payload;
            const mission = data?.mission ?? null;
            return {
              mission,
              queuedRequests: data?.queuedRequests ?? [],
              responderAvailability: data?.responder?.availability ?? mission?.responder?.availability ?? "offline",
            };
          }),
          warm(`responder-history:${user.id}`, "/api/responder/history", (payload) => payload?.data?.assignments ?? payload?.assignments ?? []),
          warm(`responder-notifications:${user.id}`, "/api/notifications", (payload) => payload?.data?.notifications ?? payload?.notifications ?? []),
          warm(`responder-availability:${user.id}`, "/api/responder/availability", (payload) => {
            const data = payload?.data ?? payload;
            const responder = data?.responder ?? payload?.responder ?? (data?.availability ? data : null);
            return responder
              ? { ...responder, active_assignment_status: data?.active_assignment_status ?? responder.active_assignment_status ?? null }
              : null;
          }),
        ]
        : [warm(`dispatcher-notifications:${user.id}`, "/api/notifications", (payload) => payload?.data?.notifications ?? payload?.notifications ?? [])];

    void Promise.all(tasks);
    return () => { cancelled = true; };
  }, [user?.id, user?.role, termsAccepted, setupComplete]);
  useEffect(() => {
    if (!user || !termsAccepted || !setupComplete) return;
    nav.forEach((item) => router.prefetch(item.href));
  }, [nav, router, user, termsAccepted, setupComplete]);
  useEffect(() => {
    const onLogoutStart = () => setExternalLoggingOut(true);
    window.addEventListener("live:logout-start", onLogoutStart);
    return () => window.removeEventListener("live:logout-start", onLogoutStart);
  }, []);
  useEffect(() => {
    if (user?.role !== "requester" || !setupComplete) return;
    let timer: number | undefined;
    const onLanguageChange = () => {
      setLanguageChanging(true);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setLanguageChanging(false), 500);
    };
    window.addEventListener("live:language-changed", onLanguageChange);
    return () => {
      window.removeEventListener("live:language-changed", onLanguageChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [user?.role, setupComplete]);
  useEffect(() => { if (user && termsAccepted && setupComplete && !pathname.startsWith(`/app/${user.role}`)) router.replace(roleHome(user.role)); }, [user, termsAccepted, setupComplete, pathname, router]);
  useEffect(() => {
    const openAccountFromVoice = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (user?.role !== "requester" || !detail) return;
      if (detail.action === "open-help") {
        if (accountOpen) {
          setAccountOpen(false);
          setRequesterHelpOpen(true);
          return;
        }
        const pageHelpButton = document.querySelector<HTMLElement>('[data-live-page-help-trigger="true"]');
        if (pageHelpButton?.getClientRects().length) {
          window.dispatchEvent(new CustomEvent("live:requester-voice-action", { detail: { action: "page-help" } }));
        } else {
          setRequesterHelpOpen(true);
        }
        return;
      }
      if (detail.action !== "open-account-menu") return;
      const bounds = accountTriggerRef.current?.getBoundingClientRect();
      if (bounds) setAccountMenuPosition({ top: bounds.bottom + 8, right: Math.max(8, window.innerWidth - bounds.right) });
      setAccountOpen(true);
    };
    window.addEventListener("live:requester-voice-action", openAccountFromVoice);
    return () => window.removeEventListener("live:requester-voice-action", openAccountFromVoice);
  }, [accountOpen, user?.role]);
  useEffect(() => {
    if (!accountOpen) return;
    function closeAccountMenu(event: MouseEvent) {
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target) && !accountTriggerRef.current?.contains(target)) setAccountOpen(false);
    }
    document.addEventListener("mousedown", closeAccountMenu);
    return () => document.removeEventListener("mousedown", closeAccountMenu);
  }, [accountOpen]);
  useEffect(() => {
    if (!logoutConfirmOpen) return;
    const frame = window.requestAnimationFrame(() => logoutCancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !navigationDisabled) setLogoutConfirmOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [logoutConfirmOpen, navigationDisabled]);
  if (loading) return <PageSkeleton />;
  if (!user) return <main className="grid min-h-[60dvh] place-items-center px-5"><div className="max-w-md text-center"><h1 className="text-lg font-semibold text-[#102b3f]">Your session could not be verified.</h1><p className="mt-2 text-sm text-[#667b89]">Please sign in again to continue.</p><Button className="mt-5" onClick={() => router.replace("/login")}>Return to sign in</Button></div></main>;
  if (!termsAccepted) return <TermsAcceptanceSheet />;
  if (!setupComplete) return <SettingsSetupSheet />;
  const mobilePrimary = nav.slice(0, 4); const mobilePrimaryHrefs = new Set(mobilePrimary.map((item) => item.href)); const moreItems = nav.filter((item) => !mobilePrimaryHrefs.has(item.href)).filter((item) => !(user.role === "admin" && item.href === "/app/admin/settings"));
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}><CallProvider><div className={cn("min-h-svh bg-[#f6f8fb]", navigationDisabled && "cursor-wait")}>
    {user.role === "requester" ? <BlindRequesterAnnouncements userId={user.id} userName={user.name} language={uiLanguage} /> : null}
    {user.role === "requester" ? <RequesterCancellationNoticeAlert userId={user.id} /> : null}
    {user.role === "responder" ? <ResponderCancellationApprovedAlert userId={user.id} /> : null}
    {languageChanging ? <div role="status" aria-live="polite" className="fixed inset-0 z-[100] grid place-items-center bg-[#071a29]/35 px-5 backdrop-blur-[2px]"><div className="flex items-center gap-3 rounded-xl border border-[#dce5ea] bg-white px-5 py-4 text-sm font-semibold text-[#102b3f] shadow-xl"><LoaderCircle className="h-5 w-5 animate-spin text-[#0f6872]" />{requesterText(uiLanguage, "Changing language...")}</div></div> : null}
    <header className="sticky top-0 z-40 border-b border-[#dfe7ec] bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        <Brand href={roleHome(user.role)} />
        {user.role !== "admin" ? <Link href={`/app/${user.role}/support`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#617582] transition hover:bg-[#f1f6f7] hover:text-[#0f5b67]" aria-label="Contact support" title="Support"><Headphones className="h-5 w-5" /></Link> : null}
        <nav className="no-scrollbar hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto md:flex" aria-label="Workspace navigation">
          {nav.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); const hasUnread = hasUnreadForNavigation(user.role, item.href, unreadNotificationCount); return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) event.preventDefault(); }} className={cn("relative inline-flex h-16 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition", active ? "border-[#0f5b67] text-[#0f5b67]" : "border-transparent text-[#617582] hover:border-[#b8c9d0] hover:text-[#102b3f]", navigationDisabled && "pointer-events-none opacity-60")}><span className="relative"><Icon className="h-4 w-4" />{hasUnread ? <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-[#d53f3d] ring-2 ring-white" aria-label={requesterText(uiLanguage, "Notifications")} /> : null}</span>{item.label}</Link>; })}
        </nav>
        <div className="relative ml-auto flex items-center gap-2">
          {user.role === "requester" ? <RequesterVoiceCommands language={uiLanguage} /> : null}
          {user.role === "requester" || user.role === "responder" ? <AreaDispatchCallButton role={user.role} /> : null}
          {user.role === "dispatcher" ? <DispatcherPeerCallButton /> : null}
          <AccessibilityPreferences placement="header" />
          <button ref={accountTriggerRef} data-live-voice-number={user.role === "requester" && pathname === "/app/requester" ? "5" : undefined} disabled={navigationDisabled} onClick={() => { const bounds = accountTriggerRef.current?.getBoundingClientRect(); if (bounds) setAccountMenuPosition({ top: bounds.bottom + 8, right: Math.max(8, window.innerWidth - bounds.right) }); setAccountOpen((open) => !open); }} className="flex h-10 items-center gap-2 border-b-2 border-transparent p-1.5 pr-2 transition hover:border-[#b8c9d0] disabled:pointer-events-none disabled:opacity-60" aria-label="Open account menu" aria-expanded={accountOpen}>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#102b3f] text-[10px] font-bold text-white">{user.initials}</span>
            <span className="hidden text-left lg:block"><span className="block max-w-32 truncate text-xs font-semibold">{user.name}</span><span className="block text-[10px] text-[#758792]">{roleLabel(user.role)}</span></span>
          </button>
        </div>
      </div>
    </header>
    {accountOpen ? createPortal(<>
      <div ref={accountMenuRef} className="fixed z-[1001] min-w-40 rounded-lg border border-[#dfe7ec] bg-white p-1 shadow-lg" style={{ top: accountMenuPosition.top, right: accountMenuPosition.right }} role="menu" aria-label="Account menu">
        <div className="flex min-h-8 items-center justify-between border-b border-[#e8eef1] px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#71838e]"><span>Account</span><button type="button" aria-label="Close account menu" onClick={() => setAccountOpen(false)} className="rounded p-1 text-[#617582] hover:bg-[#f1f6f7]"><X className="h-3.5 w-3.5" /></button></div>
        <Link href={user.role === "requester" ? "/app/requester/settings?section=profile" : user.role === "responder" ? "/app/responder/settings?section=profile" : user.role === "dispatcher" ? "/app/dispatcher/profile" : `/app/${user.role}/profile`} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) { event.preventDefault(); return; } setAccountOpen(false); }} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7]", navigationDisabled && "pointer-events-none opacity-50")} role="menuitem"><UserRound className="h-3.5 w-3.5 text-[#0f5b67]" />{user.role === "requester" ? requesterText(uiLanguage, "Profile") : "Profile"}</Link>
        {(user.role === "requester" || user.role === "responder" || user.role === "dispatcher" || user.role === "admin" || user.role === "auditor" || user.role === "manager") ? <Link href={`/app/${user.role}/settings`} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) { event.preventDefault(); return; } setAccountOpen(false); }} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7]", navigationDisabled && "pointer-events-none opacity-50")} role="menuitem"><Settings className="h-3.5 w-3.5 text-[#0f5b67]" />{user.role === "requester" ? requesterText(uiLanguage, "Settings") : "Settings"}</Link> : null}
        {user.role === "requester" ? <button type="button" disabled={navigationDisabled} onClick={() => { setAccountOpen(false); setRequesterHelpOpen(true); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:pointer-events-none disabled:opacity-50" role="menuitem"><CircleHelp className="h-3.5 w-3.5 text-[#0f5b67]" />{requesterText(uiLanguage, "Help")}</button> : null}
        {user.role === "responder" ? <button type="button" disabled={navigationDisabled} onClick={() => { setAccountOpen(false); setResponderHelpOpen(true); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:pointer-events-none disabled:opacity-50" role="menuitem"><CircleHelp className="h-3.5 w-3.5 text-[#0f5b67]" />Help</button> : null}
        {(["dispatcher", "admin", "auditor", "manager"] as const).includes(user.role as RoleHelpActor) ? <button type="button" disabled={navigationDisabled} onClick={() => { setAccountOpen(false); setRoleHelpActor(user.role as RoleHelpActor); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:pointer-events-none disabled:opacity-50" role="menuitem"><CircleHelp className="h-3.5 w-3.5 text-[#0f5b67]" />Help</button> : null}
        <button disabled={navigationDisabled} onClick={() => void handleLogout()} className="flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-semibold text-[#102b3f] transition hover:bg-[#f1f6f7] disabled:cursor-wait disabled:opacity-60" role="menuitem">
          {loggingOut ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#0f5b67]" /> : <LogOut className="h-3.5 w-3.5 text-[#0f5b67]" />}{loggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>
    </>, document.body) : null}
    {logoutConfirmOpen ? createPortal(
      <div className="fixed inset-0 z-[150] grid place-items-center bg-[#071a29]/45 p-4 backdrop-blur-[2px]">
        <button type="button" aria-label="Keep calling and close confirmation" className="absolute inset-0" onClick={() => { if (!navigationDisabled) setLogoutConfirmOpen(false); }} />
        <section role="alertdialog" aria-modal="true" aria-labelledby="logout-call-title" aria-describedby="logout-call-description" className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[#dce5ea] bg-white shadow-2xl">
          <header className="border-b border-[#dce5ea] px-5 py-4">
            <h2 id="logout-call-title" className="flex items-center gap-2 font-semibold text-[#102b3f]"><PhoneCall className="h-4 w-4 text-[#0f6872]" />Active LIVE call</h2>
            <p id="logout-call-description" className="mt-1 text-sm leading-6 text-[#667b89]">A LIVE call is still active. Logging out will end the call. Continue?</p>
          </header>
          <div className="flex gap-3 p-4">
            <Button ref={logoutCancelRef} type="button" variant="outline" className="flex-1" disabled={navigationDisabled} onClick={() => setLogoutConfirmOpen(false)}>Keep calling</Button>
            <Button type="button" variant="danger" className="flex-1" disabled={navigationDisabled} onClick={() => void finishLogout()}><LogOut className="h-4 w-4" />End call and log out</Button>
          </div>
        </section>
      </div>,
      document.body,
    ) : null}
    <main className={cn("min-h-[calc(100svh-4rem)]", navigationDisabled && "pointer-events-none select-none opacity-70")} aria-busy={navigationDisabled}>{children}</main>
    <SharedAiLauncher />
    <nav className={cn("safe-bottom fixed inset-x-0 bottom-0 z-50 isolate pointer-events-auto border-t border-[#dce5ea] bg-white/94 px-2 pt-1.5 backdrop-blur-xl md:hidden", mobileKeyboardOpen && "hidden")} aria-label="Mobile navigation" aria-hidden={mobileKeyboardOpen}>
      <div className={cn("mx-auto grid max-w-md gap-1", navigationDisabled && "pointer-events-none opacity-60")} style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + (moreItems.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}>{mobilePrimary.map(item => { const Icon = item.icon; const active = activeFor(pathname, item.href); const hasUnread = hasUnreadForNavigation(user.role, item.href, unreadNotificationCount); return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition", active ? "text-[#0f5b67]" : "text-[#71828d]")}>{item.primary ? <span className={cn("grid h-10 w-10 place-items-center rounded-full text-white transition", active ? "bg-[#bf3533]" : "bg-[#d53f3d]")}><Icon className="h-5 w-5" /></span> : <span className="relative"><Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />{hasUnread ? <span className="absolute -right-2 -top-1 h-2.5 w-2.5 rounded-full bg-[#d53f3d] ring-2 ring-white" aria-label={requesterText(uiLanguage, "Notifications")} /> : null}</span>}<span>{item.mobileLabel || item.label}</span>{active && !item.primary ? <span className="absolute top-0 h-0.5 w-7 bg-[#0f5b67]" /> : null}</Link>; })}{moreItems.length > 0 ? <button disabled={navigationDisabled} onClick={() => setMoreOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold text-[#71828d] disabled:cursor-wait"><MoreHorizontal className="h-5 w-5" /><span>More</span></button> : null}</div>
    </nav>
    {moreItems.length > 0 ? <Sheet open={moreOpen} onOpenChange={(open) => { if (!navigationDisabled) setMoreOpen(open); }} dismissible={!navigationDisabled} title="More" showTitle={false} className="rounded-t-[16px]"><div className="divide-y divide-[#dfe7ec] border-y border-[#dfe7ec]">{moreItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} aria-disabled={navigationDisabled} tabIndex={navigationDisabled ? -1 : undefined} onClick={(event) => { if (navigationDisabled) { event.preventDefault(); return; } setMoreOpen(false); }} className={cn("flex min-h-14 items-center gap-3 px-5 font-semibold", navigationDisabled && "pointer-events-none opacity-60") }><Icon className="h-5 w-5 text-[#0f5b67]" />{item.label}</Link>; })}</div></Sheet> : null}
    {user.role === "requester" ? <RequesterHelpSheet open={requesterHelpOpen} onOpenChange={setRequesterHelpOpen} /> : null}
    {user.role === "responder" ? <ResponderHelpSheet open={responderHelpOpen} onOpenChange={setResponderHelpOpen} /> : null}
    {roleHelpActor ? <RoleHelpSheet actor={roleHelpActor} open onOpenChange={(open) => { if (!open) setRoleHelpActor(null); }} /> : null}
  </div></CallProvider></MotionConfig>;
}

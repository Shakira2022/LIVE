"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headphones, Home, Plus, UserRound } from "lucide-react";
import { Brand } from "@/components/layout/brand";

export function PublicHeader({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();
  const centeredNavigation = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/terms-and-conditions",
    "/support",
  ].includes(pathname);

  const itemClass = (active = false) =>
    `inline-flex min-h-16 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-bold transition sm:px-4 ${
      active
        ? "border-[#0f6872] text-[#0f6872]"
        : "border-transparent text-[#536879] hover:border-[#b8dcdf] hover:text-[#102b3f]"
    }`;

  return (
    <>
    <header className="sticky inset-x-0 top-0 z-50 border-b border-[#e2e8ed]/90 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        <Brand compact={centeredNavigation} />
        {centeredNavigation ? (
          <nav className={`no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto ${disabled ? "pointer-events-none opacity-60" : ""}`} aria-disabled={disabled}>
            <div className="mx-auto flex w-max items-center">
            <Link href="/" className={itemClass(pathname === "/")} aria-label="Home" title="Home" tabIndex={disabled ? -1 : undefined}>
              <Home aria-hidden="true" className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Home</span>
            </Link>
            {pathname !== "/login" ? (
              <Link href="/login" className={itemClass()} aria-label="Sign in" title="Sign in" tabIndex={disabled ? -1 : undefined}>
                <UserRound aria-hidden="true" className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            ) : null}
            {pathname !== "/register" ? (
              <Link
                href="/register"
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#0f5b67] px-2.5 py-2.5 text-xs font-bold text-white transition hover:bg-[#0b4d57] sm:px-4"
                tabIndex={disabled ? -1 : undefined}
              >
                <span className="hidden sm:inline">Create account</span>
                <span className="sm:hidden">Register</span>
                <Plus aria-hidden="true" className="order-2 h-4 w-4 sm:hidden" />
              </Link>
            ) : null}
            {pathname !== "/forgot-password" ? (
              <Link href="/forgot-password" className={itemClass()} aria-label="Forgot password?" title="Forgot password?" tabIndex={disabled ? -1 : undefined}>
                <span className="hidden sm:inline">Forgot password?</span>
                <span className="sm:hidden">Forgot?</span>
              </Link>
            ) : null}
            </div>
          </nav>
        ) : (
          <nav className="ml-auto flex items-center gap-2">
            {pathname !== "/login" ? <Link href="/login" className="px-3 py-2 text-xs font-bold text-[#536879]">Sign in</Link> : null}
            {pathname === "/" ? <Link href="/register" className="rounded-xl bg-[#0f5b67] px-4 py-2.5 text-xs font-bold text-white">Create account</Link> : null}
          </nav>
        )}
      </div>
    </header>
    <Link href="/support" aria-label="Contact support" title="Support" className="fixed bottom-5 right-5 z-[60] grid h-12 w-12 place-items-center rounded-full border border-[#cfe0e5] bg-white text-[#0f6872] shadow-lg transition hover:bg-[#eaf4f5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6872]/20"><Headphones className="h-5 w-5" /></Link>
    </>
  );
}

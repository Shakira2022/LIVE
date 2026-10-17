"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function PublicHeader({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();
  const centeredNavigation = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/terms-and-conditions",
  ].includes(pathname);

  const itemClass = (active = false) =>
    `inline-flex min-h-16 items-center gap-2 border-b-2 px-3 text-xs font-bold transition sm:px-4 ${
      active
        ? "border-[#0f6872] text-[#0f6872]"
        : "border-transparent text-[#536879] hover:border-[#b8dcdf] hover:text-[#102b3f]"
    }`;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#e2e8ed]/90 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-center px-4 sm:px-6">
        {centeredNavigation ? (
          <nav className={`flex h-full items-center ${disabled ? "pointer-events-none opacity-60" : ""}`} aria-disabled={disabled}>
            <Link href="/" className={itemClass(pathname === "/")} aria-label="Home" tabIndex={disabled ? -1 : undefined}>
              <span className="hidden sm:inline">Home</span>
              <span className="sm:hidden">Home</span>
            </Link>
            {pathname !== "/login" ? (
              <Link href="/login" className={itemClass()} tabIndex={disabled ? -1 : undefined}>
                <span className="hidden sm:inline">Sign in</span>
                <span className="sm:hidden">Sign in</span>
              </Link>
            ) : null}
            {pathname !== "/register" ? (
              <Link href="/register" className={itemClass()} tabIndex={disabled ? -1 : undefined}>
                <span>Register</span>
              </Link>
            ) : null}
            {pathname !== "/forgot-password" ? (
              <Link href="/forgot-password" className={itemClass()} tabIndex={disabled ? -1 : undefined}>
                <span className="hidden sm:inline">Forgot password</span>
                <span className="sm:hidden">Forgot?</span>
              </Link>
            ) : null}
          </nav>
        ) : (
          <nav className="ml-auto flex items-center gap-2">
            {pathname === "/" ? <Link href="/#about" className="px-3 py-2 text-xs font-bold text-[#536879]">About</Link> : null}
            {pathname !== "/login" ? <Link href="/login" className="px-3 py-2 text-xs font-bold text-[#536879]">Sign in</Link> : null}
            {pathname === "/" ? <Link href="/register" className="rounded-xl bg-[#0f5b67] px-4 py-2.5 text-xs font-bold text-white">Create account</Link> : null}
          </nav>
        )}
      </div>
    </header>
  );
}

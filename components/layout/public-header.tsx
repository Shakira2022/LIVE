"use client";
import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
export function PublicHeader() {
  const pathname = usePathname(); const router = useRouter(); const auth = ["/login","/register","/forgot-password"].includes(pathname);
  return <header className="fixed inset-x-0 top-0 z-50 border-b border-[#e2e8ed]/90 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6"><div className="flex items-center gap-3">{auth ? <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => router.back()}><ArrowLeft className="h-5 w-5"/></Button> : null}<Brand compact /></div><nav className="flex items-center gap-2">{pathname !== "/login" ? <Link href="/login"><Button variant="ghost" size="sm"><LogIn className="h-4 w-4"/>Sign in</Button></Link> : null}{pathname === "/" ? <Link href="/register"><Button size="sm">Create account</Button></Link> : null}</nav></div></header>;
}

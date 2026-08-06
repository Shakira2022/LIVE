"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { PageSkeleton } from "@/components/ui/skeleton";
import { roleHome } from "@/lib/utils";
export default function AppIndex(){ const {user,loading}=useAuth(); const router=useRouter(); useEffect(()=>{ if(!loading) router.replace(user?roleHome(user.role):"/login"); },[loading,user,router]); return <PageSkeleton/>; }

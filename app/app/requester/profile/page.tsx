"use client";

import { RequesterProfileContent } from "@/components/requester/profile-content";
import { useSearchParams } from "next/navigation";

export default function RequesterProfile() {
  const searchParams = useSearchParams();
  return <div className="app-page"><RequesterProfileContent autoEdit={searchParams.get("edit") === "true"} /></div>;
}

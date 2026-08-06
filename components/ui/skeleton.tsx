import { cn } from "@/lib/utils";
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer relative overflow-hidden rounded-lg bg-[#e7edf1]", className)} />;
}
export function PageSkeleton({ map = false }: { map?: boolean }) {
  return <div className="app-page grid gap-5"><div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-4 w-24"/><Skeleton className="h-8 w-56"/><Skeleton className="h-4 w-72 max-w-[72vw]"/></div><Skeleton className="h-11 w-11 rounded-full"/></div>{map?<Skeleton className="h-[58dvh] min-h-[410px] rounded-[24px]"/>:<><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24 rounded-2xl"/><Skeleton className="h-24 rounded-2xl"/><Skeleton className="h-24 rounded-2xl"/></div><Skeleton className="h-72 rounded-[24px]"/></>}</div>;
}

import { cn } from "@/lib/utils";
export function PageHeading({ eyebrow, title, description, action, compact = false }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode; compact?: boolean }) {
  return <header className={cn("flex items-start justify-between gap-4", compact ? "" : "mb-1")}><div className="min-w-0">{eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#0f5b67]">{eyebrow}</p> : null}<h1 className={cn("mt-1 font-bold tracking-[-.035em] text-[#102b3f]", compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl")}>{title}</h1>{description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667b89]">{description}</p> : null}</div>{action ? <div className="shrink-0">{action}</div> : null}</header>;
}

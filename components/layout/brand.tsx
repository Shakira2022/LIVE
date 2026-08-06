import { RadioTower } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5" aria-label="LIVE home">
      <span
        className={cn(
          "grid place-items-center rounded-xl bg-[#102b3f] text-white shadow-[0_8px_18px_rgba(16,43,63,.16)]",
          compact ? "h-9 w-9" : "h-10 w-10",
        )}
      >
        <RadioTower className={compact ? "h-[18px] w-[18px]" : "h-5 w-5"} />
      </span>
      <span className="text-xl font-bold tracking-[-0.02em] text-[#102b3f]">LIVE</span>
    </Link>
  );
}

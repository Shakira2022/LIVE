import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "danger" | "warning" | "success" | "blue" | "violet" | "teal" | "green" | "amber" | "red" | "slate";
const tones: Record<Tone, string> = {
  brand: "border-[#b8dcdf] bg-[#e7f3f4] text-[#0f5b67]",
  danger: "border-[#f0c8c7] bg-[#ffeded] text-[#af2f2d]",
  warning: "border-[#f0d9b4] bg-[#fff6e6] text-[#9b5d12]",
  success: "border-[#bce1d2] bg-[#e8f8f0] text-[#176d4a]",
  blue: "border-[#c8dbef] bg-[#edf5fc] text-[#245f92]",
  violet: "border-[#d9cdf1] bg-[#f4effc] text-[#6d49a0]",
  teal: "border-[#b8dcdf] bg-[#e7f3f4] text-[#0f5b67]",
  green: "border-[#bce1d2] bg-[#e8f8f0] text-[#176d4a]",
  amber: "border-[#f0d9b4] bg-[#fff6e6] text-[#9b5d12]",
  red: "border-[#f0c8c7] bg-[#ffeded] text-[#af2f2d]",
  slate: "border-[#d6dfe5] bg-[#f1f4f6] text-[#536879]",
};
export function Badge({ className, tone = "slate", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold tracking-wide", tones[tone], className)} {...props} />;
}

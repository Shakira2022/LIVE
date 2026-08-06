import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "danger" | "success" | "warning" | "outline" | "ghost" | "soft";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary: "border-transparent bg-[#0f5b67] text-white hover:bg-[#0b4b55] shadow-[0_8px_20px_rgba(15,91,103,.16)]",
  danger: "border-transparent bg-[#d53f3d] text-white hover:bg-[#bd3331] shadow-[0_8px_20px_rgba(213,63,61,.16)]",
  success: "border-transparent bg-[#1f845b] text-white hover:bg-[#176d4a]",
  warning: "border-transparent bg-[#b97018] text-white hover:bg-[#9e5d0f]",
  outline: "border-[#d7e0e7] bg-white text-[#183246] hover:border-[#aabac6] hover:bg-[#f8fafb]",
  ghost: "border-transparent bg-transparent text-[#536879] hover:bg-[#edf2f5] hover:text-[#102b3f]",
  soft: "border-transparent bg-[#e7f3f4] text-[#0f5b67] hover:bg-[#d9edef]",
};
const sizeStyles: Record<Size, string> = {
  sm: "min-h-9 px-3 text-xs",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-[52px] px-5 text-sm sm:text-base",
  icon: "h-11 w-11 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl border font-bold transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/15 disabled:pointer-events-none disabled:opacity-50 active:scale-[.985]",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

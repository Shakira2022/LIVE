import { forwardRef } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return <span className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[.08em] text-[#5d7180]"><span>{children}</span>{optional ? <span className="normal-case tracking-normal text-[#94a3ae]">Optional</span> : null}</span>;
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-12 w-full border-0 border-b border-[#cbd7de] bg-transparent px-0 text-sm text-[#102b3f] outline-none transition placeholder:text-[#98a7b3] focus:border-b-2 focus:border-[#0f5b67] focus:ring-0", className)} {...props} />
));
Input.displayName = "Input";
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("min-h-28 w-full resize-none border-0 border-b border-[#cbd7de] bg-transparent px-0 py-3 text-sm leading-6 text-[#102b3f] outline-none transition placeholder:text-[#98a7b3] focus:border-b-2 focus:border-[#0f5b67] focus:ring-0", className)} {...props} />
));
Textarea.displayName = "Textarea";
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn("h-12 w-full border-0 border-b border-[#cbd7de] bg-transparent px-0 text-sm text-[#102b3f] outline-none transition focus:border-b-2 focus:border-[#0f5b67] focus:ring-0", className)} {...props} />
));
Select.displayName = "Select";

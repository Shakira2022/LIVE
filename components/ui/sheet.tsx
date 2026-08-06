"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Sheet({ open, onOpenChange, title, description, children, side = "bottom", className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  side?: "bottom" | "right";
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [open, onOpenChange]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button aria-label="Close sheet" className="absolute inset-0 bg-[#071a29]/45 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />
          <motion.section
            role="dialog" aria-modal="true" aria-label={title}
            initial={side === "bottom" ? { y: "100%" } : { x: "100%" }}
            animate={side === "bottom" ? { y: 0 } : { x: 0 }}
            exit={side === "bottom" ? { y: "100%" } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 330, damping: 34 }}
            className={cn(
              "absolute flex flex-col overflow-hidden bg-white shadow-2xl",
              side === "bottom" ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[28px]" : "inset-y-0 right-0 w-full max-w-lg",
              className,
            )}
          >
            {side === "bottom" ? <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#d9e1e7]" /> : null}
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e0e7ec] px-5 py-4 sm:px-6">
              <div><h2 className="text-lg font-semibold tracking-[-.02em] text-[#102b3f]">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-[#687b89]">{description}</p> : null}</div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}><X className="h-5 w-5"/></Button>
            </header>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

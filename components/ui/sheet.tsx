"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock: string | null = null;

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) bodyOverflowBeforeLock = document.body.style.overflow;
  bodyScrollLockCount += 1;
  document.body.style.overflow = "hidden";
  return () => {
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock ?? "";
      bodyOverflowBeforeLock = null;
    }
  };
}

export function Sheet({ open, onOpenChange, title, description, children, footer, side = "bottom", className, scrollAreaClassName, footerClassName, showTitle = true, dismissible = true }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "bottom" | "right" | "center";
  className?: string;
  scrollAreaClassName?: string;
  footerClassName?: string;
  showTitle?: boolean;
  dismissible?: boolean;
}) {
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const unlockBodyScroll = lockBodyScroll();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && dismissible && onOpenChangeRef.current(false);
    window.addEventListener("keydown", onKey);
    return () => { unlockBodyScroll(); window.removeEventListener("keydown", onKey); };
  }, [open, dismissible]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button aria-label="Close sheet" disabled={!dismissible} className="absolute inset-0 bg-[#071a29]/45 backdrop-blur-[2px] disabled:cursor-wait" onClick={() => onOpenChange(false)} />
          <motion.section
            role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
            initial={side === "bottom" ? { y: "100%" } : side === "center" ? { opacity: 0, scale: 0.96, x: "-50%", y: "-50%" } : { x: "100%" }}
            animate={side === "bottom" ? { y: 0 } : side === "center" ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" } : { x: 0 }}
            exit={side === "bottom" ? { y: "100%" } : side === "center" ? { opacity: 0, scale: 0.96, x: "-50%", y: "-50%" } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 330, damping: 34 }}
            className={cn(
              "absolute flex flex-col overflow-hidden bg-white shadow-2xl",
              side === "bottom" ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[28px]" : side === "center" ? "left-1/2 top-1/2 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg rounded-2xl" : "inset-y-0 right-0 w-full max-w-lg",
              className,
            )}
          >
            {side === "bottom" ? <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#d9e1e7]" /> : null}
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e0e7ec] px-5 py-4 sm:px-6">
              {showTitle ? <div><h2 className="text-lg font-semibold tracking-[-.02em] text-[#102b3f]">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-[#687b89]">{description}</p> : null}</div> : <div className="flex-1" aria-hidden="true" />}
              <Button variant="ghost" size="icon" aria-label="Close" disabled={!dismissible} onClick={() => onOpenChange(false)}><X className="h-5 w-5"/></Button>
            </header>
            <div data-live-voice-status-host="true" className="flex shrink-0 justify-end empty:hidden" />
            <div data-live-voice-focus-hint className="hidden shrink-0 items-center gap-2 border-b border-[#f1dfa9] bg-[#fff8df] px-5 py-2 text-xs font-semibold text-[#705400] sm:px-6">
              Voice control is active. Say “next option”, “previous option”, “button six”, “scroll down”, “scroll up”, or “close”.
            </div>
            <div data-live-keyboard-scroll-area className={cn("mobile-keyboard-scroll-area no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4", scrollAreaClassName)}>{children}<div aria-hidden="true" className="shrink-0" style={{ height: "var(--live-keyboard-height)" }} /></div>
            {footer ? <footer className={cn("safe-bottom shrink-0 border-t border-[#e0e7ec] bg-white px-5 py-4 sm:px-6", footerClassName)}>{footer}</footer> : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

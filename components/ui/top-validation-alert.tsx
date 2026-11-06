"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

export function TopValidationAlert({
  open,
  onClose,
  message,
  items,
  listHeading = "Please check these fields:",
  autoDismissMs = 0,
  topClassName = "top-4",
}: {
  open: boolean;
  onClose: () => void;
  message?: string;
  items?: string[];
  listHeading?: string;
  autoDismissMs?: number;
  topClassName?: string;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || autoDismissMs <= 0) return;
    const timeout = window.setTimeout(() => onCloseRef.current(), autoDismissMs);
    return () => window.clearTimeout(timeout);
  }, [open, autoDismissMs]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`pointer-events-none fixed inset-x-0 ${topClassName} z-[10000] flex flex-col items-center gap-2 px-4`}>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="top-validation-alert"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="pointer-events-auto w-full max-w-md rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-800 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                {items?.length ? (
                  <>
                    <p className="font-bold">{listHeading}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </>
                ) : (
                  <p>{message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 rounded-full p-1 text-[#667b89] hover:bg-[#eef3f5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

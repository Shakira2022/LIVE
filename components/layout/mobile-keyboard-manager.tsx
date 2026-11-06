"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type VirtualKeyboard = {
  overlaysContent: boolean;
  boundingRect: DOMRect;
  addEventListener: (type: "geometrychange", listener: () => void) => void;
  removeEventListener: (type: "geometrychange", listener: () => void) => void;
};

const EDITABLE_FIELD = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, select';

export function MobileKeyboardManager() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const virtualKeyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
    if (virtualKeyboard) virtualKeyboard.overlaysContent = false;
    setMounted(true);
    let viewportHeightWithoutKeyboard = Math.max(
      window.innerHeight,
      viewport?.height ?? 0,
    );

    let focusTimers: number[] = [];
    let animationFrame = 0;
    let revealUntil = 0;
    let userInitiatedScroll = false;
    let keyboardDismissed = false;
    let keyboardWasObservedOpen = false;
    let keyboardFallbackUsed = false;
    let focusStartedAt = 0;
    let autoScrollSnapshot: { element: HTMLElement | null; top: number } | null = null;
    let touchGesture: { field: HTMLElement | null; x: number; y: number; moved: boolean } | null = null;

    const rememberScrollPosition = (element: HTMLElement | null) => {
      if (autoScrollSnapshot) return;
      autoScrollSnapshot = { element, top: element ? element.scrollTop : window.scrollY };
    };

    const restoreScrollPosition = () => {
      const snapshot = autoScrollSnapshot;
      autoScrollSnapshot = null;
      if (!snapshot || userInitiatedScroll) return;
      window.requestAnimationFrame(() => {
        if (snapshot.element) snapshot.element.scrollTo({ top: snapshot.top, behavior: "auto" });
        else window.scrollTo({ top: snapshot.top, behavior: "auto" });
      });
    };

    const readKeyboardGeometry = () => {
      const overlayHeight = virtualKeyboard?.boundingRect.height ?? 0;
      const visualBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const viewportInset = Math.max(0, viewportHeightWithoutKeyboard - (viewport?.height ?? window.innerHeight));
      return { height: Math.max(overlayHeight, viewportInset), overlayHeight, visualBottom, viewportInset };
    };

    const revealFocusedField = () => {
      if (userInitiatedScroll || keyboardDismissed || Date.now() > revealUntil) return;
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !activeElement.matches(EDITABLE_FIELD) || activeElement.hasAttribute("data-live-keyboard-scroll-self")) return;

      const isSmallTouchScreen = window.matchMedia("(max-width: 767px)").matches
        && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
      const { height: measuredKeyboardHeight, overlayHeight, visualBottom, viewportInset } = readKeyboardGeometry();
      if (measuredKeyboardHeight >= 80) keyboardWasObservedOpen = true;
      const keyboardHeight = measuredKeyboardHeight >= 80
        ? measuredKeyboardHeight
        : isSmallTouchScreen
          ? Math.min(360, Math.max(240, window.innerHeight * 0.38))
          : 0;
      if (keyboardHeight < 80) return;
      if (measuredKeyboardHeight < 80) keyboardFallbackUsed = true;
      // Keep the estimate for focused-field positioning, but reserve extra
      // scroll space only when the keyboard overlays rather than resizes the
      // viewport. This avoids adding a second keyboard-sized gap on phones
      // that already resize the visible page.
      const keyboardOverlaysViewport = overlayHeight >= 80 && viewportInset < 80;
      document.documentElement.style.setProperty(
        "--live-keyboard-height",
        `${keyboardOverlaysViewport ? overlayHeight : 0}px`,
      );

      const rect = activeElement.getBoundingClientRect();
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = viewportInset >= 80
        ? visualBottom
        : overlayHeight >= 80
          ? window.innerHeight - overlayHeight
          : Math.min(visualBottom, window.innerHeight - keyboardHeight);
      if (rect.top >= visibleTop + 8 && rect.bottom <= visibleBottom - 12) return;

      const delta = rect.bottom > visibleBottom - 12
        ? rect.bottom - (visibleBottom - 12)
        : rect.top < visibleTop + 8
          ? rect.top - (visibleTop + 8)
          : 0;

      if (delta !== 0) {
        const sheetScrollArea = activeElement.closest<HTMLElement>("[data-live-keyboard-scroll-area]");
        let scrollContainer = activeElement.parentElement;
        while (scrollContainer && scrollContainer !== document.body) {
          const overflowY = window.getComputedStyle(scrollContainer).overflowY;
          if ((overflowY === "auto" || overflowY === "scroll") && scrollContainer.scrollHeight > scrollContainer.clientHeight + 1) break;
          scrollContainer = scrollContainer.parentElement;
        }

        const targetScrollArea = sheetScrollArea
          ?? (scrollContainer && scrollContainer !== document.body ? scrollContainer : null);
        if (targetScrollArea && targetScrollArea.scrollHeight > targetScrollArea.clientHeight + 1) {
          rememberScrollPosition(targetScrollArea);
          targetScrollArea.scrollBy({ top: delta, behavior: "auto" });
          return;
        }
        rememberScrollPosition(null);
        window.scrollBy({ top: delta, behavior: "auto" });
        return;
      }

      rememberScrollPosition(null);
      activeElement.scrollIntoView({ block: "center", behavior: "auto" });
    };

    const scheduleReveal = (extendWindow = false) => {
      if (userInitiatedScroll) return;
      if (extendWindow) revealUntil = Math.max(revealUntil, Date.now() + 350);
      if (Date.now() > revealUntil) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(revealFocusedField);
    };

    const handleKeyboardGeometryChange = () => {
      const { height } = readKeyboardGeometry();
      if (height >= 80) {
        keyboardWasObservedOpen = true;
        scheduleReveal(true);
        return;
      }

      const viewportRestored = (viewport?.height ?? window.innerHeight) >= viewportHeightWithoutKeyboard - 80;
      const fallbackKeyboardClosed = keyboardFallbackUsed && Date.now() - focusStartedAt > 700;
      if (viewportRestored && (keyboardWasObservedOpen || fallbackKeyboardClosed)) {
        keyboardDismissed = true;
        revealUntil = 0;
        document.documentElement.style.setProperty("--live-keyboard-height", "0px");
        restoreScrollPosition();
        viewportHeightWithoutKeyboard = Math.max(
          window.innerHeight,
          viewport?.height ?? 0,
        );
        return;
      }
      scheduleReveal();
    };
    const onKeyboardGeometryChange = handleKeyboardGeometryChange;
    const onUserScroll = () => {
      userInitiatedScroll = true;
      autoScrollSnapshot = null;
      if (readKeyboardGeometry().height < 80) {
        document.documentElement.style.setProperty("--live-keyboard-height", "0px");
        revealUntil = 0;
      }
      if (keyboardDismissed) {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement.matches(EDITABLE_FIELD)) activeElement.blur();
      }
    };
    const startKeyboardSession = () => {
      userInitiatedScroll = false;
      keyboardDismissed = false;
      keyboardWasObservedOpen = false;
      keyboardFallbackUsed = false;
      focusStartedAt = Date.now();
      revealUntil = focusStartedAt + 1200;
      focusTimers.forEach((timer) => window.clearTimeout(timer));
      focusTimers = [180, 360, 600, 900].map((delay) => window.setTimeout(scheduleReveal, delay));
    };
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target;
      const field = target instanceof HTMLElement ? target.closest<HTMLElement>(EDITABLE_FIELD) : null;
      const touch = event.touches[0];
      if (!touch) return;
      touchGesture = {
        field: field && !field.hasAttribute("data-live-keyboard-scroll-self") ? field : null,
        x: touch.clientX,
        y: touch.clientY,
        moved: false,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchGesture || touchGesture.moved) return;
      const touch = event.touches[0];
      if (!touch || Math.hypot(touch.clientX - touchGesture.x, touch.clientY - touchGesture.y) < 10) return;
      touchGesture.moved = true;
      onUserScroll();
    };
    const onTouchEnd = () => {
      const gesture = touchGesture;
      touchGesture = null;
      if (gesture?.field && !gesture.moved && document.activeElement === gesture.field) startKeyboardSession();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(EDITABLE_FIELD) || target.hasAttribute("data-live-keyboard-scroll-self")) return;
      startKeyboardSession();
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement) || !activeElement.matches(EDITABLE_FIELD)) {
          document.documentElement.style.setProperty("--live-keyboard-height", "0px");
          revealUntil = 0;
          keyboardDismissed = true;
          restoreScrollPosition();
          viewportHeightWithoutKeyboard = Math.max(
            window.innerHeight,
            viewport?.height ?? 0,
          );
        }
      }, 250);
    };

    document.documentElement.style.setProperty("--live-keyboard-height", "0px");
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    document.addEventListener("wheel", onUserScroll, { passive: true });
    viewport?.addEventListener("resize", handleKeyboardGeometryChange);
    virtualKeyboard?.addEventListener("geometrychange", onKeyboardGeometryChange);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("wheel", onUserScroll);
      viewport?.removeEventListener("resize", handleKeyboardGeometryChange);
      virtualKeyboard?.removeEventListener("geometrychange", onKeyboardGeometryChange);
      focusTimers.forEach((timer) => window.clearTimeout(timer));
      window.cancelAnimationFrame(animationFrame);
      document.documentElement.style.setProperty("--live-keyboard-height", "0px");
    };
  }, []);

  return mounted && typeof document !== "undefined"
    ? createPortal(<div aria-hidden="true" data-live-keyboard-page-spacer="true" className="pointer-events-none w-full" style={{ height: "var(--live-keyboard-height)" }} />, document.body)
    : null;
}

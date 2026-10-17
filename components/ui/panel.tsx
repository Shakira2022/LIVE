import type {
  HTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * true:
   * Keep the card appearance on mobile and desktop.
   *
   * false:
   * Use a flat, border-only section on mobile,
   * then restore the card appearance on larger screens.
   */
  mobileCard?: boolean;
};

export function Panel({
  className,
  children,
  mobileCard: _mobileCard = false,
  ...props
}: PanelProps) {
  return (
    <section
      className={cn(
        "overflow-hidden border-y border-[#dce5ea] bg-white shadow-none rounded-none",

        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

type PanelHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function PanelHeader({
  title,
  description,
  action,
  className,
}: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4",
        "border-b border-[#e2e8ed]",
        "px-4 py-4 sm:px-5 sm:py-5",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold tracking-[-0.015em] text-[#102b3f] sm:text-lg">
          {title}
        </h2>

        {description ? (
          <p className="mt-1 text-sm leading-6 text-[#667b89]">
            {description}
          </p>
        ) : null}
      </div>

      {action ? (
        <div className="shrink-0">
          {action}
        </div>
      ) : null}
    </header>
  );
}

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center",
        "px-5 py-10 text-center",
        className
      )}
    >
      {icon ? (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e7f3f4] text-[#0f6872]">
          {icon}
        </span>
      ) : null}

      <h3
        className={cn(
          "text-lg font-semibold tracking-[-0.015em] text-[#102b3f]",
          icon ? "mt-4" : ""
        )}
      >
        {title}
      </h3>

      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#667b89]">
          {description}
        </p>
      ) : null}

      {action ? (
        <div className="mt-5">
          {action}
        </div>
      ) : null}
    </div>
  );
}

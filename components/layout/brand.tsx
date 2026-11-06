import Link from "next/link";

export function Brand({ href = "/", compact = false }: { compact?: boolean; href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Live home"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e7f3f4] py-1.5 pl-1.5 ${compact ? "pr-1.5 sm:pr-3" : "pr-3"} transition-colors hover:bg-[#d7eeee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6872]`}
    >
      <svg aria-hidden="true" viewBox="0 0 40 40" className="h-[2.125rem] w-[2.125rem] shrink-0">
        {/* badge */}
        <circle cx="20" cy="20" r="20" fill="#0f6872" />
        {/* location pin */}
        <path
          d="M20 7.5c-4.9 0-8.8 3.8-8.8 8.6 0 6.3 7 12.9 8.8 14.9 1.8-2 8.8-8.6 8.8-14.9 0-4.8-3.9-8.6-8.8-8.6z"
          fill="#ffffff"
        />
        {/* live pulse inside the pin */}
        <path
          d="M14.6 16.4h3l1.6-3.4 2.6 6.6 1.7-3.2h2"
          fill="none"
          stroke="#0f6872"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* live signal dot */}
        <circle cx="31" cy="9" r="3" fill="#0f6872" />
        <circle cx="31" cy="9" r="1.1" fill="#ffffff" />
      </svg>
      <span className={`font-sans ${compact ? "hidden sm:inline" : "inline"} shrink-0 self-center whitespace-nowrap text-[1.2rem] font-bold leading-none tracking-[-0.02em] text-[#0f5b67]`}>
        Live
      </span>
    </Link>
  );
}

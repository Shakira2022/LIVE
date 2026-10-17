import Link from "next/link";

export function Brand({ href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center" aria-label="LIVE home">
      <span className="text-xl font-bold tracking-[-0.02em] text-[#102b3f]">LIVE</span>
    </Link>
  );
}

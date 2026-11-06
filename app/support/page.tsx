import { PublicHeader } from "@/components/layout/public-header";
import { SupportContactForm } from "@/components/support/support-contact-form";

export default function SupportPage() {
  return <div className="min-h-dvh bg-transparent"><PublicHeader /><main className="mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-6 sm:pt-12"><div className="p-1 sm:p-4"><h1 className="text-3xl font-bold tracking-[-.025em] text-[#102b3f]">How can we help?</h1><p className="mt-3 text-sm leading-6 text-[#667b89]">Tell our support team what is happening. For an immediate emergency, contact the appropriate emergency services directly.</p></div><SupportContactForm /></main></div>;
}

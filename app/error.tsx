"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">LIVE</p>
        <h1 className="mt-3 text-2xl font-bold">This page ran into a problem</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Try loading the page again. If someone needs urgent help, call 10177,
          10111, or 112 from a mobile phone.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Go to home
          </a>
        </div>
      </section>
    </main>
  );
}

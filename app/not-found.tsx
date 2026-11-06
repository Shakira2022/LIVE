export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">LIVE</p>
        <h1 className="mt-3 text-2xl font-bold">This page could not be found</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Check the address or return to the LIVE home page.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Go to home
        </a>
      </section>
    </main>
  );
}

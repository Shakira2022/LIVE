"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f6f8fb", color: "#102b3f", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "100%", maxWidth: 520, padding: 28, background: "white", border: "1px solid #d9e2e9", borderRadius: 18 }}>
            <p style={{ color: "#0f5b67", fontWeight: 700 }}>LIVE</p>
            <h1 style={{ fontSize: 26 }}>LIVE could not open this page</h1>
            <p style={{ lineHeight: 1.6, color: "#526777" }}>
              Try again. For urgent help, call 10177, 10111, or 112 from a mobile phone.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ border: 0, borderRadius: 9, padding: "11px 16px", background: "#0f5b67", color: "white", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
            <a href="/" style={{ marginLeft: 14, color: "#0f5b67", fontWeight: 700 }}>
              Go to home
            </a>
          </section>
        </main>
      </body>
    </html>
  );
}

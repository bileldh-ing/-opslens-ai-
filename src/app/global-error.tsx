"use client";

import "./globals.css";

/** Last-resort boundary: replaces the root layout, so it renders its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body>
        <main className="grid min-h-screen place-items-center px-6">
          <div className="max-w-md text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-base font-bold">O</span>
            <h1 className="mt-6 text-2xl font-semibold">OpsLens hit an unexpected error</h1>
            <p className="mt-3 text-sm text-muted">
              Reload the page to continue.{error.digest ? ` Reference: ${error.digest}` : ""}
            </p>
            <button onClick={reset} className="mt-8 rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-blue-500">
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

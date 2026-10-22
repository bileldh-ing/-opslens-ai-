"use client";

import { useEffect } from "react";

/** Keeps the sidebar visible when a workspace page fails; only the content area is replaced. */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-panel p-8 text-center" role="alert">
      <p className="font-mono text-sm text-accent">Error</p>
      <h1 className="mt-2 text-lg font-semibold">This view failed to load</h1>
      <p className="mt-2 text-sm text-muted">
        Your data is safe. Try again, and if it keeps happening share the reference with your admin.
        {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
      </p>
      <button onClick={reset} className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-blue-500">
        Try again
      </button>
    </div>
  );
}

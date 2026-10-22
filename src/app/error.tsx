"use client";

import { useEffect } from "react";
import Link from "next/link";
import { StatusScreen } from "@/components/status-screen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusScreen
      code="500"
      title="Something went wrong"
      description={`An unexpected error interrupted this page.${error.digest ? ` Reference: ${error.digest}` : ""}`}
    >
      <button onClick={reset} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-blue-500">
        Try again
      </button>
      <Link href="/" className="rounded-lg border border-border px-4 py-2 text-sm text-slate-200 hover:bg-panel-2">
        Back to home
      </Link>
    </StatusScreen>
  );
}

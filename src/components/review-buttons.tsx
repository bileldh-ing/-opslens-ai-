"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function ReviewButtons({ orgSlug, id }: { orgSlug: string; id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const review = (decision: "approved" | "rejected") =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/orgs/${orgSlug}/remediations/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      if (!res.ok) setError((await res.json()).error ?? "Review failed");
      else router.refresh();
    });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (optional)"
        className="min-w-60 flex-1 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm" />
      <Button disabled={pending} onClick={() => review("approved")}>Approve</Button>
      <Button disabled={pending} variant="outline" onClick={() => review("rejected")}>Reject</Button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </div>
  );
}

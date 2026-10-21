"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

type Kind = "logs" | "docs";

export function UploadPanel({ orgSlug, projects }: { orgSlug: string; projects: { slug: string; name: string }[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>("logs");
  const [project, setProject] = useState(projects[0]?.slug ?? "");
  const [sourceType, setSourceType] = useState("runbook");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage({ tone: "error", text: "Choose a file first." });
    setBusy(true);
    setMessage(null);
    const body = new FormData();
    body.set("file", file);
    if (kind === "docs") body.set("sourceType", sourceType);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${project}/${kind === "logs" ? "ingest" : "documents"}`, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "error", text: json.error ?? `Upload failed (${res.status})` });
    if (json.mode === "queued") setMessage({ tone: "ok", text: `Queued as job ${json.jobId}. The worker will process it shortly.` });
    else if (kind === "logs" && json.result)
      setMessage({ tone: "ok", text: `Ingested ${json.result.accepted} events into ${json.result.errorGroups} error group(s); ${json.result.rejected} line(s) rejected, ${json.result.incidents.length} incident(s) opened or updated.` });
    else setMessage({ tone: "ok", text: "Indexed for retrieval." });
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={upload} className="space-y-4">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="tablist">
        {(["logs", "docs"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1.5 ${kind === k ? "bg-panel-2 text-white" : "text-muted"}`}
          >
            {k === "logs" ? "Log file" : "Runbook / doc"}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {kind === "logs"
          ? "JSON lines or plain text. Errors are fingerprinted into groups, and bursts open incidents linked to the deploy before them."
          : "Markdown or text. Chunked, embedded into pgvector and searchable by the investigation agent."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm">
          {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        {kind === "docs" && (
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} aria-label="Document type" className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm">
            <option value="runbook">Runbook</option>
            <option value="postmortem">Postmortem</option>
            <option value="architecture">Architecture</option>
            <option value="code">Code</option>
          </select>
        )}
        <input ref={fileRef} type="file" accept={kind === "logs" ? ".log,.jsonl,.json,.txt" : ".md,.txt,.markdown"} aria-label="File"
          className="flex-1 rounded-lg border border-dashed border-border bg-panel-2/50 px-3 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-2.5 file:py-1 file:text-slate-200" />
        <Button disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Upload</Button>
      </div>
      {message && <p className={`text-sm ${message.tone === "ok" ? "text-emerald-400" : "text-red-400"}`}>{message.text}</p>}
    </form>
  );
}

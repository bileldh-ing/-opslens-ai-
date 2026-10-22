"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2, Search, Wrench } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { InvestigationReport } from "@/server/ai/report";

const TOOL_LABELS: Record<string, string> = {
  search_logs: "Searching logs",
  list_error_groups: "Grouping recurring errors",
  get_deployments: "Checking deployments",
  search_docs: "Searching docs & runbooks",
  search_past_incidents: "Looking for similar incidents",
  submit_report: "Writing report",
};

export function InvestigationChat({
  orgSlug,
  projects,
  initialProject,
  incidentId,
  initialQuestion,
}: {
  orgSlug: string;
  projects: { slug: string; name: string }[];
  initialProject?: string;
  incidentId?: string;
  initialQuestion?: string;
}) {
  const [project, setProject] = useState(initialProject ?? "");
  const [input, setInput] = useState(initialQuestion ?? "");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/orgs/${orgSlug}/projects/${project}/investigate`,
      body: { incidentId },
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="mt-6 space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="rounded-lg border border-border bg-panel-2 px-3 text-sm">
          {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Question"
          placeholder="Why did the payment service start returning 500s after the last deploy?"
          className="flex-1 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <Button disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Investigate</Button>
      </form>

      {error && <p className="text-sm text-red-400">{error.message}</p>}

      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "rounded-xl bg-panel-2 p-4 text-sm" : "space-y-3"}>
            {m.parts.map((part, i) => {
              if (part.type === "text") return <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>;
              if (part.type.startsWith("tool-")) {
                const name = part.type.slice(5);
                const p = part as { state: string; output?: { report?: InvestigationReport } };
                if (name === "submit_report" && p.state === "output-available" && p.output?.report) {
                  return <ReportView key={i} report={p.output.report} />;
                }
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted">
                    {p.state === "output-available" ? <Wrench className="h-3.5 w-3.5 text-accent" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {TOOL_LABELS[name] ?? name}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: InvestigationReport }) {
  return (
    <div className="space-y-5 rounded-xl border border-border bg-panel p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Investigation report</h3>
        <Badge value={report.status} />
      </div>
      <p className="text-sm text-slate-300">{report.summary}</p>
      {report.hypotheses.map((h, i) => (
        <div key={i} className="rounded-lg bg-panel-2 p-4">
          <div className="flex justify-between gap-4">
            <p className="text-sm font-medium">{i + 1}. {h.cause}</p>
            <span className="shrink-0 text-xs text-muted">{Math.round(h.confidence * 100)}% confidence</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">{h.reasoning}</p>
          <ul className="mt-3 space-y-1.5">
            {h.evidence.map((c, j) => (
              <li key={j} className="font-mono text-xs text-slate-400"><span className="text-accent">[{c.type}:{c.id.slice(0, 8)}]</span> {c.excerpt}</li>
            ))}
          </ul>
          {h.counterEvidence.length > 0 && <p className="mt-2 text-xs text-amber-300/80">Against: {h.counterEvidence.join("; ")}</p>}
        </div>
      ))}
      {report.unknowns.length > 0 && (
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted">Uncertainty</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">{report.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
      )}
      {report.nextSteps.length > 0 && (
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted">Next steps</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{report.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
      )}
      {report.remediations.length > 0 && (
        <p className="text-xs text-muted">{report.remediations.length} remediation proposal(s) were sent to the approval queue.</p>
      )}
    </div>
  );
}

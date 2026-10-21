import Link from "next/link";
import { Activity, Bot, GitBranch, ShieldCheck } from "lucide-react";

const features = [
  { icon: Activity, title: "Incident intelligence", body: "Ingest logs, group recurring errors by fingerprint, and link spikes to the deployment that preceded them." },
  { icon: Bot, title: "AI investigation agent", body: "Tool-calling agent with RAG over your docs and past incidents. Every claim cites a log line, and it says when it isn't sure." },
  { icon: ShieldCheck, title: "Safe remediation", body: "Runbooks, diagnostic queries and draft patches land as proposals. Nothing ships without an audited human approval." },
  { icon: GitBranch, title: "Built for teams", body: "Organizations, projects, role-based access, invitations, plan limits and a full audit log." },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-24">
      <p className="text-sm font-medium text-accent">OpsLens AI</p>
      <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight">
        Ask why production broke. Get an answer with <span className="text-accent">evidence</span>.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        “Why did our payment service start returning 500 errors after the last deployment?” OpsLens pulls the logs, the deploy diff, your runbooks and similar past incidents, then gives you ranked hypotheses with citations and a reviewed fix plan.
      </p>
      <div className="mt-10 flex gap-3">
        <Link href="/signup" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">Create workspace</Link>
        <Link href="/login" className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium">Sign in</Link>
      </div>
      <div className="mt-20 grid gap-4 md:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-panel p-6">
            <f.icon className="h-5 w-5 text-accent" />
            <h3 className="mt-4 font-medium">{f.title}</h3>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

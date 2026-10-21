import Link from "next/link";
import { Activity, Bot, CheckCircle2, GitBranch, ShieldCheck, Wrench } from "lucide-react";

const features = [
  { icon: Activity, title: "Incident intelligence", body: "Ingest logs, group recurring errors by fingerprint, and link spikes to the deployment that preceded them." },
  { icon: Bot, title: "AI investigation agent", body: "Tool-calling agent with RAG over your docs and past incidents. Every claim cites a log line, and it says when it isn't sure." },
  { icon: ShieldCheck, title: "Safe remediation", body: "Runbooks, diagnostic queries and draft patches land as proposals. Nothing ships without an audited human approval." },
  { icon: GitBranch, title: "Built for teams", body: "Organizations, projects, role-based access, invitations, plan limits and a full audit log." },
];

const steps = [
  "Grouping recurring errors",
  "Checking deployments",
  "Searching logs",
  "Searching docs & runbooks",
  "Looking for similar incidents",
];

export default function Landing() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.18),transparent_60%)]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <p className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-xs font-bold">O</span>
          OpsLens <span className="text-accent">AI</span>
        </p>
        <nav className="flex gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-slate-300 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-accent px-3 py-2 font-medium hover:bg-blue-500">Get started</Link>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-blue-200">Production incident investigation</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Ask why production broke. Get an answer with <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">evidence</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            OpsLens reads your logs, deployments, runbooks and past incidents, then returns ranked hypotheses with verified citations, honest confidence, and a fix plan that waits for human approval.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500">Create workspace</Link>
            <Link href="/login" className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-panel-2">Open the demo</Link>
          </div>
          <p className="mt-4 text-xs text-muted">Demo login: <span className="font-mono text-slate-300">demo@opslens.dev</span> / <span className="font-mono text-slate-300">opslens-demo-123</span></p>
        </div>

        <div className="rounded-2xl border border-border bg-panel/90 p-5 shadow-2xl shadow-blue-950/40">
          <div className="rounded-lg bg-panel-2 p-3 text-sm">Why did payment-service start returning 500s after the last deploy?</div>
          <ul className="mt-4 space-y-2">
            {steps.map((s) => (
              <li key={s} className="flex items-center gap-2 text-xs text-muted"><Wrench className="h-3.5 w-3.5 text-accent" />{s}</li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-bg/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Investigation report</p>
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/30">likely cause found</span>
            </div>
            <p className="mt-3 text-sm">1. Regression in payment-service v2.14.0 (4f7d1b2)</p>
            <div className="mt-2 h-1.5 rounded-full bg-panel-2"><div className="h-full w-[82%] rounded-full bg-gradient-to-r from-accent to-accent-2" /></div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-slate-400">
              <span className="text-accent">[deployment:4f7d1b2c]</span> reduce gateway timeout from 10s to 2s<br />
              <span className="text-accent">[log:9b1e…]</span> PaymentGatewayTimeout after 2000ms on POST /v1/charges
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-200/80"><CheckCircle2 className="h-3.5 w-3.5" /> Rollback to v2.13.0 queued for approval</p>
          </div>
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-panel p-6">
            <f.icon className="h-5 w-5 text-accent" />
            <h3 className="mt-4 font-medium">{f.title}</h3>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

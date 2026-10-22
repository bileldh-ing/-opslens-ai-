"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Loader2, Play, Send } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { HookState, KeyState } from "@/app/actions/integrations";

function CopyBox({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-xs text-emerald-300">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all font-mono text-xs text-slate-200" data-testid={testId}>{value}</code>
        <button
          type="button"
          className="shrink-0 text-muted hover:text-white"
          aria-label="Copy to clipboard"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

const selectCls = "rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm";

export function ApiKeyForm({
  action,
  projects,
}: {
  action: (s: KeyState, f: FormData) => Promise<KeyState>;
  projects: Array<{ slug: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="name" required minLength={2} maxLength={60} placeholder="Key name, e.g. otel-collector-prod" className="flex-1" aria-label="Key name" />
        <select name="project" aria-label="Project" className={selectCls} defaultValue={projects[0]?.slug}>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <Button disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Create key</Button>
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.key && <CopyBox value={state.key} testId="new-api-key" label={`Key "${state.name}" created. Copy it now: it is stored hashed and will not be shown again.`} />}
    </form>
  );
}

export function WebhookForm({ action }: { action: (s: HookState, f: FormData) => Promise<HookState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Input name="name" required minLength={2} maxLength={60} placeholder="Name, e.g. #incidents Slack" aria-label="Webhook name" />
        <Input name="url" type="url" required placeholder="https://hooks.slack.com/services/…" aria-label="Webhook URL" />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <select name="format" aria-label="Payload format" className={selectCls} defaultValue="json">
          <option value="json">Generic JSON (signed)</option>
          <option value="slack">Slack-compatible</option>
        </select>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" name="events" value="incident.created" defaultChecked className="accent-blue-500" /> New incident
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" name="events" value="incident.status_changed" defaultChecked className="accent-blue-500" /> Status change
        </label>
        <Button variant="outline" disabled={pending} className="ml-auto">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Add webhook</Button>
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.secret && <CopyBox value={state.secret} testId="webhook-secret" label={`${state.ok} Signing secret (verify X-OpsLens-Signature with it). Shown once.`} />}
    </form>
  );
}

export function WebhookTestButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" className="px-2.5 py-1 text-xs" disabled={pending} onClick={() => start(async () => setResult(await action()))}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Test
      </Button>
      {result && <span role="status" className={`text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>{result.message}</span>}
    </span>
  );
}

export function RunEvalsButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex items-center gap-3">
      {result && <span role="status" className={`text-sm ${result.ok ? "text-emerald-400" : "text-amber-300"}`}>{result.message}</span>}
      <Button type="button" disabled={pending} onClick={() => start(async () => setResult(await action()))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run evals now
      </Button>
    </div>
  );
}

export function ConfirmSubmit({ children, message, className }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      className={className ?? "text-xs text-muted hover:text-red-300"}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

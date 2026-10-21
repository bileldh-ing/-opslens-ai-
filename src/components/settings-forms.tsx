"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { ActionState } from "@/app/actions/workspace";

type InviteState = { error?: string; inviteUrl?: string } | null;

export function InviteForm({ action }: { action: (state: InviteState, form: FormData) => Promise<InviteState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="email" type="email" required placeholder="teammate@company.com" className="flex-1" aria-label="Email" />
        <select name="role" defaultValue="member" aria-label="Role" className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm">
          <option value="viewer">Viewer</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <Button disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Invite</Button>
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.inviteUrl && (
        <div className="flex items-center gap-2 rounded-lg bg-panel-2 p-2.5 text-xs">
          <code className="flex-1 truncate text-slate-300">{state.inviteUrl}</code>
          <button
            type="button"
            className="text-muted hover:text-white"
            onClick={() => {
              navigator.clipboard.writeText(state.inviteUrl!);
              setCopied(true);
            }}
            aria-label="Copy invite link"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      )}
    </form>
  );
}

export function ProjectForm({ action }: { action: (state: ActionState, form: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="name" required placeholder="Project name, e.g. Staging" className="flex-1" aria-label="Project name" />
        <Button variant="outline" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Create project</Button>
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-400">{state.ok}</p>}
    </form>
  );
}

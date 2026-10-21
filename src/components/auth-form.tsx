"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import type { FormState } from "@/app/actions/auth";

type Field = { name: string; label: string; type?: string; autoComplete?: string; defaultValue?: string };

export function AuthForm({
  title,
  action,
  fields,
  submit,
  footer,
  hint,
}: {
  title: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  footer: { text: string; href: string; link: string };
  hint?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-panel p-8 shadow-2xl shadow-blue-950/30">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-xs font-bold">O</span>
          OpsLens <span className="text-accent">AI</span>
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {hint}
        {fields.map((f) => (
          <label key={f.name} className="block space-y-1.5 text-sm">
            <span className="text-muted">{f.label}</span>
            <Input name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} defaultValue={f.defaultValue} required />
          </label>
        ))}
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full">{pending ? "Please wait…" : submit}</Button>
        <p className="text-center text-sm text-muted">
          {footer.text} <Link href={footer.href} className="text-accent">{footer.link}</Link>
        </p>
      </form>
    </main>
  );
}

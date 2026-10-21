"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import type { FormState } from "@/app/actions/auth";

type Field = { name: string; label: string; type?: string; autoComplete?: string };

export function AuthForm({
  title,
  action,
  fields,
  submit,
  footer,
}: {
  title: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  footer: { text: string; href: string; link: string };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-panel p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {fields.map((f) => (
          <label key={f.name} className="block space-y-1.5 text-sm">
            <span className="text-muted">{f.label}</span>
            <Input name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required />
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

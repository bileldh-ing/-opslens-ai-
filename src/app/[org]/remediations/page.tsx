import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { listRemediations } from "@/server/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewButtons } from "@/components/review-buttons";
import { EmptyState } from "@/components/empty-state";
import { ShieldCheck } from "lucide-react";

export default async function Remediations({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  const rows = await listRemediations(org.id);
  const canApprove = can(role, "remediation.approve");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Remediations</h1>
      <p className="text-sm text-muted">AI-proposed runbooks, diagnostic queries and patches. Nothing runs until an admin approves it.</p>
      {rows.map(({ remediation: r, requester }) => (
        <Card key={r.id}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">{r.title}</p>
              <p className="mt-1 text-xs text-muted">{r.kind.replace("_", " ")} · proposed for {requester ?? "unknown"} · {r.createdAt.toLocaleString()}</p>
            </div>
            <div className="flex gap-2"><Badge value={r.riskLevel} /><Badge value={r.status} /></div>
          </div>
          <pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-bg p-4 text-xs text-slate-300">{r.content}</pre>
          {r.status === "pending_approval" && canApprove && <ReviewButtons orgSlug={slug} id={r.id} />}
          {r.reviewNote && <p className="mt-3 text-xs text-muted">Review note: {r.reviewNote}</p>}
        </Card>
      ))}
      {rows.length === 0 && (
        <EmptyState icon={ShieldCheck} title="No proposals yet" description="When an investigation suggests a rollback, runbook or patch, it lands here for review." />
      )}
    </div>
  );
}

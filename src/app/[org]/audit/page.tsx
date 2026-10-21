import { requireOrg } from "@/lib/auth";
import { listAudit } from "@/server/queries";

export default async function AuditPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug, "audit.read");
  const rows = await listAudit(org.id);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-panel-2 text-left text-muted"><tr><th className="px-4 py-3">When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
          <tbody className="divide-y divide-border bg-panel">
            {rows.map(({ log, actor }) => (
              <tr key={log.id}>
                <td className="px-4 py-2.5 text-muted">{log.createdAt.toLocaleString()}</td>
                <td>{actor ?? "system"}</td>
                <td className="font-mono text-xs">{log.action}</td>
                <td className="text-muted">{log.targetType}{log.targetId ? `:${log.targetId.slice(0, 8)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

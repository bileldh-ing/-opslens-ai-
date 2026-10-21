import { requireOrg } from "@/lib/auth";
import { listProjects } from "@/server/queries";
import { InvestigationChat } from "@/components/investigation-chat";

export default async function InvestigatePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ project?: string; incident?: string; q?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org } = await requireOrg(slug, "investigation.run");
  const projects = await listProjects(org.id);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">AI investigation</h1>
      <p className="mt-1 text-sm text-muted">Answers are grounded in your logs, deployments, docs and past incidents, with citations. Proposed fixes need approval.</p>
      <InvestigationChat
        orgSlug={slug}
        projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
        initialProject={sp.project ?? projects[0]?.slug}
        incidentId={sp.incident}
        initialQuestion={sp.q}
      />
    </div>
  );
}

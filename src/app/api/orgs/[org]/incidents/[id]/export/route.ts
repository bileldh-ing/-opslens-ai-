import { getOrgContextForApi } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/logger";
import { slugify } from "@/lib/utils";
import { buildIncidentReport, incidentReportToCsv } from "@/server/export";

export const dynamic = "force-dynamic";

/** GET ?format=json|csv → downloadable incident report. Org-scoped; non-members get 404. */
export async function GET(req: Request, ctx: { params: Promise<{ org: string; id: string }> }) {
  try {
    const { org: orgSlug, id } = await ctx.params;
    const auth = await getOrgContextForApi(orgSlug);
    if (!auth) return jsonError(401, "Unauthorized");
    assertCan(auth.role, "incident.export");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Incident not found");
    const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
    const report = await buildIncidentReport(auth.org.id, id);
    if (!report) return jsonError(404, "Incident not found");

    await audit({
      orgId: auth.org.id,
      actorId: auth.user.id,
      action: "incident.export",
      targetType: "incident",
      targetId: id,
      metadata: { format },
      ip: clientIp(req.headers),
    });
    const name = `incident-${slugify(report.incident.title).slice(0, 40) || "report"}-${id.slice(0, 8)}.${format}`;
    const body = format === "csv" ? incidentReportToCsv(report) : JSON.stringify(report, null, 2);
    return new Response(body, {
      headers: {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err, req);
  }
}

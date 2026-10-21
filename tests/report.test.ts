import { describe, expect, it } from "vitest";
import { verifyCitations, type InvestigationReport } from "@/server/ai/report";
import { chunkText } from "@/server/ingest/chunk";

const base: InvestigationReport = {
  summary: "s",
  status: "likely_cause_found",
  hypotheses: [
    { cause: "timeout too low", confidence: 0.8, reasoning: "r", counterEvidence: [],
      evidence: [{ type: "log", id: "L1", excerpt: "timeout" }, { type: "deployment", id: "D1", excerpt: "2s" }] },
    { cause: "made up", confidence: 0.6, reasoning: "r", counterEvidence: [],
      evidence: [{ type: "doc", id: "FAKE", excerpt: "x" }] },
  ],
  unknowns: [],
  nextSteps: [],
  remediations: [],
};

describe("verifyCitations (anti-hallucination guardrail)", () => {
  it("keeps verified evidence and removes hypotheses with only fabricated citations", () => {
    const { report, dropped } = verifyCitations(base, new Set(["log:L1", "deployment:D1"]));
    expect(report.hypotheses).toHaveLength(1);
    expect(report.hypotheses[0].cause).toBe("timeout too low");
    expect(dropped).toEqual(["doc:FAKE"]);
    expect(report.unknowns.at(-1)).toMatch(/could not be verified/);
  });
  it("discounts confidence and downgrades status when evidence is partly unverifiable", () => {
    const { report } = verifyCitations(base, new Set(["log:L1"]));
    expect(report.hypotheses[0].confidence).toBe(0.4);
    expect(report.status).toBe("inconclusive");
  });
});

describe("chunkText", () => {
  it("splits long text into bounded chunks", () => {
    const text = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n${"word ".repeat(80)}`).join("\n\n");
    const chunks = chunkText(text, 200, 20);
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(200 * 4 + 200);
  });
});

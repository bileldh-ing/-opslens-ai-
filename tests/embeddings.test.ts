import { describe, expect, it } from "vitest";
import { embedTexts, hashEmbedding } from "@/server/ai/embeddings";

describe("local hashing embeddings", () => {
  it("are 1536-dim, unit length and deterministic", async () => {
    const [a, b] = await embedTexts(["gateway timeout on charges", "gateway timeout on charges"]);
    expect(a).toHaveLength(1536);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(a).toEqual(b);
  });

  it("rank lexically similar text higher", () => {
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    const q = hashEmbedding("payment gateway timeout");
    expect(dot(q, hashEmbedding("gateway timeout raised for payment charges"))).toBeGreaterThan(
      dot(q, hashEmbedding("cart UI copy changes")),
    );
  });
});

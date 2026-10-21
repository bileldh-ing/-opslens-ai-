import { embed, embedMany } from "ai";
import { aiConfigured, embeddingModel } from "./models";

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Embeddings for RAG. With a provider configured we use it; otherwise we fall back to a
 * deterministic feature-hashing embedding (unigrams + bigrams, signed hashing, L2-normalised).
 * The fallback keeps retrieval, seeding and tests working offline; quality is lexical, not semantic.
 */
export async function embedText(value: string): Promise<number[]> {
  if (!aiConfigured) return hashEmbedding(value);
  const { embedding } = await embed({ model: embeddingModel(), value });
  return embedding;
}

export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  if (!aiConfigured) return values.map((v) => hashEmbedding(v));
  const { embeddings } = await embedMany({ model: embeddingModel(), values, maxParallelCalls: 4 });
  return embeddings;
}

const STOPWORDS = new Set("a an and are as at be by for from in is it of on or that the this to was were with".split(" "));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbedding(text: string, dims = EMBEDDING_DIMENSIONS): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = tokenize(text);
  const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
  for (const f of features) {
    const h = fnv1a(f);
    vec[h % dims] += (h & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}

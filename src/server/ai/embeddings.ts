import { embed, embedMany } from "ai";
import { embeddingModel } from "./models";

export async function embedText(value: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value });
  return embedding;
}

export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({ model: embeddingModel(), values, maxParallelCalls: 4 });
  return embeddings;
}

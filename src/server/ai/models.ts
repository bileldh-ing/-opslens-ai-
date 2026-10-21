import { createOpenAI } from "@ai-sdk/openai";

/**
 * Single place to swap providers. Any OpenAI-compatible endpoint works
 * (OpenAI, Azure, Groq, Together, or a local Ollama at http://localhost:11434/v1).
 */
export const chatModelId = process.env.AI_CHAT_MODEL ?? "gpt-4.1-mini";
export const embeddingModelId = process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small";

/** True when a chat/embedding provider is configured. Without one, OpsLens runs in demo mode. */
export const aiConfigured = Boolean(process.env.OPENAI_API_KEY || process.env.AI_BASE_URL);

const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "not-needed-for-local",
  baseURL: process.env.AI_BASE_URL,
});

export const chatModel = () => provider(chatModelId);
export const embeddingModel = () => provider.embedding(embeddingModelId);

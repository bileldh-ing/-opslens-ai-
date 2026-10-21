import { openai } from "@ai-sdk/openai";

/** Single place to swap providers (OpenAI, Anthropic, local via OpenAI-compatible endpoints). */
export const chatModelId = process.env.AI_CHAT_MODEL ?? "gpt-4.1-mini";
export const embeddingModelId = process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small";

export const chatModel = () => openai(chatModelId);
export const embeddingModel = () => openai.embedding(embeddingModelId);

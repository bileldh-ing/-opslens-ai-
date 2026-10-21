import { storage } from "@/lib/storage";
import { indexDocument, ingestLogs } from "../ingest/pipeline";
import type { JobName, JobPayloads } from "./queue";

export const handlers: { [N in JobName]: (data: JobPayloads[N]) => Promise<unknown> } = {
  "ingest-logs": async ({ projectId, storageKey, service }) => {
    const content = (await storage.get(storageKey)).toString("utf8");
    return ingestLogs(projectId, content, service);
  },
  "index-document": async ({ projectId, storageKey, title, sourceType }) => {
    const content = (await storage.get(storageKey)).toString("utf8");
    return indexDocument({ projectId, title, sourceType, content, storageKey });
  },
};

export async function runJob(name: JobName, data: unknown) {
  const handler = handlers[name] as ((d: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error(`Unknown job ${name}`);
  return handler(data);
}

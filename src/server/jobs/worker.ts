import { Worker, type Job } from "bullmq";
import { getRedis } from "@/lib/redis";
import { storage } from "@/lib/storage";
import { indexDocument, ingestLogs } from "../ingest/pipeline";
import { QUEUE_NAME, type JobName, type JobPayloads } from "./queue";

const handlers: { [N in JobName]: (data: JobPayloads[N]) => Promise<unknown> } = {
  "ingest-logs": async ({ projectId, storageKey, service }) => {
    const content = (await storage.get(storageKey)).toString("utf8");
    return ingestLogs(projectId, content, service);
  },
  "index-document": async ({ projectId, storageKey, title, sourceType }) => {
    const content = (await storage.get(storageKey)).toString("utf8");
    return indexDocument({ projectId, title, sourceType, content, storageKey });
  },
};

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const handler = handlers[job.name as JobName] as ((d: unknown) => Promise<unknown>) | undefined;
    if (!handler) throw new Error(`Unknown job ${job.name}`);
    const started = Date.now();
    const result = await handler(job.data);
    console.log(JSON.stringify({ msg: "job.completed", job: job.name, id: job.id, ms: Date.now() - started }));
    return result;
  },
  { connection: getRedis(), concurrency: 4 },
);

worker.on("failed", (job, err) =>
  console.error(JSON.stringify({ msg: "job.failed", job: job?.name, id: job?.id, error: err.message })),
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await worker.close();
    process.exit(0);
  });
}
console.log("OpsLens worker started");

import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import { getRedis, redisConfigured } from "@/lib/redis";

export type JobPayloads = {
  "ingest-logs": { projectId: string; storageKey: string; service?: string };
  "index-document": { projectId: string; storageKey: string; title: string; sourceType: string };
};
export type JobName = keyof JobPayloads;

export const QUEUE_NAME = "opslens";

let queue: Queue | undefined;
async function getQueue() {
  if (!queue) {
    const { Queue } = await import("bullmq");
    queue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

export type EnqueueResult = { jobId: string; mode: "queued" | "inline"; result?: unknown };

/**
 * With Redis configured, jobs go to BullMQ and the worker process (retries, backoff).
 * Without it (local demo), the job runs inline in the request so the app works with zero infrastructure.
 */
export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N]): Promise<EnqueueResult> {
  if (!redisConfigured) {
    const { runJob } = await import("./handlers");
    return { jobId: `inline-${randomUUID()}`, mode: "inline", result: await runJob(name, data) };
  }
  const job = await (await getQueue()).add(name, data);
  return { jobId: job.id!, mode: "queued" };
}

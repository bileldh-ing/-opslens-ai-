import { Queue } from "bullmq";
import { getRedis } from "@/lib/redis";

export type JobPayloads = {
  "ingest-logs": { projectId: string; storageKey: string; service?: string };
  "index-document": { projectId: string; storageKey: string; title: string; sourceType: string };
};
export type JobName = keyof JobPayloads;

export const QUEUE_NAME = "opslens";

let queue: Queue | undefined;
function getQueue() {
  queue ??= new Queue(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return queue;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N]): Promise<string> {
  const job = await getQueue().add(name, data);
  return job.id!;
}

import { Worker, type Job } from "bullmq";
import { getRedis } from "@/lib/redis";
import { runJob } from "./handlers";
import { QUEUE_NAME, type JobName } from "./queue";

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const started = Date.now();
    const result = await runJob(job.name as JobName, job.data);
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

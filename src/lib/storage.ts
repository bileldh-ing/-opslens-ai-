import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./utils";

/**
 * Object storage abstraction. Local disk in development; swap the implementation
 * for S3/R2/GCS in production without touching callers.
 */
export interface ObjectStorage {
  put(prefix: string, filename: string, body: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}

const ROOT = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export const storage: ObjectStorage = {
  async put(prefix, filename, body) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${prefix}/${randomToken(8)}-${safe}`;
    const full = path.join(ROOT, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return key;
  },
  async get(key) {
    if (key.includes("..")) throw new Error("Invalid key");
    return readFile(path.join(ROOT, key));
  },
};

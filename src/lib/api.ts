import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError } from "./rbac";
import { PlanLimitError } from "./plans";

export function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

/** Maps domain errors to HTTP responses so route handlers stay thin. */
export function handleApiError(err: unknown) {
  if (err instanceof ZodError) return jsonError(400, "Invalid request", err.issues);
  if (err instanceof ForbiddenError) return jsonError(403, err.message);
  if (err instanceof PlanLimitError) return jsonError(402, err.message);
  console.error(err);
  return jsonError(500, "Internal error");
}

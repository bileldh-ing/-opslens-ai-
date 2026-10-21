export type Plan = "free" | "team" | "enterprise";

export const PLAN_LIMITS: Record<
  Plan,
  { projects: number; members: number; investigationsPerDay: number; logEventsPerDay: number }
> = {
  free: { projects: 2, members: 3, investigationsPerDay: 20, logEventsPerDay: 50_000 },
  team: { projects: 20, members: 50, investigationsPerDay: 500, logEventsPerDay: 2_000_000 },
  enterprise: {
    projects: Infinity,
    members: Infinity,
    investigationsPerDay: Infinity,
    logEventsPerDay: Infinity,
  },
};

export class PlanLimitError extends Error {
  status = 402 as const;
  constructor(public limit: string, public plan: Plan) {
    super(`The ${plan} plan limit for ${limit} has been reached.`);
  }
}

export function assertWithinLimit(
  plan: Plan,
  limit: keyof (typeof PLAN_LIMITS)["free"],
  current: number,
  adding = 1,
): void {
  if (current + adding > PLAN_LIMITS[plan][limit]) throw new PlanLimitError(limit, plan);
}

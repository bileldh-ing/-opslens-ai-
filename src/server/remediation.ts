export type RemediationStatus = "draft" | "pending_approval" | "approved" | "rejected" | "executed";

/**
 * Remediation state machine. The only path to "executed" goes through "approved",
 * and approval is a separate, audited human action.
 */
const TRANSITIONS: Record<RemediationStatus, RemediationStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: ["executed"],
  rejected: [],
  executed: [],
};

export function canTransition(from: RemediationStatus, to: RemediationStatus) {
  return TRANSITIONS[from].includes(to);
}

/** High-risk changes need a second reviewer: the person who requested it cannot approve it. */
export function canReview(input: {
  requestedBy: string | null;
  reviewerId: string;
  riskLevel: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.riskLevel === "high" && input.requestedBy === input.reviewerId) {
    return { ok: false, reason: "High-risk remediations require a different reviewer than the requester." };
  }
  return { ok: true };
}

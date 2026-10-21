import { describe, expect, it } from "vitest";
import { assertCan, can, canAssignRole, ForbiddenError } from "@/lib/rbac";
import { assertWithinLimit, PlanLimitError } from "@/lib/plans";
import { canReview, canTransition } from "@/server/remediation";

describe("rbac", () => {
  it("enforces role ordering", () => {
    expect(can("viewer", "incident.read")).toBe(true);
    expect(can("viewer", "investigation.run")).toBe(false);
    expect(can("member", "remediation.approve")).toBe(false);
    expect(can("admin", "remediation.approve")).toBe(true);
    expect(can(null, "workspace.read")).toBe(false);
    expect(() => assertCan("member", "billing.manage")).toThrow(ForbiddenError);
  });
  it("prevents privilege escalation through invites", () => {
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("member", "viewer")).toBe(false);
  });
});

describe("plan limits", () => {
  it("throws when the limit would be exceeded", () => {
    expect(() => assertWithinLimit("free", "members", 3)).toThrow(PlanLimitError);
    expect(() => assertWithinLimit("team", "members", 3)).not.toThrow();
  });
});

describe("remediation workflow", () => {
  it("only reaches executed through approved", () => {
    expect(canTransition("pending_approval", "approved")).toBe(true);
    expect(canTransition("pending_approval", "executed")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
  });
  it("requires a second reviewer for high-risk changes", () => {
    expect(canReview({ requestedBy: "u1", reviewerId: "u1", riskLevel: "high" }).ok).toBe(false);
    expect(canReview({ requestedBy: "u1", reviewerId: "u2", riskLevel: "high" }).ok).toBe(true);
    expect(canReview({ requestedBy: "u1", reviewerId: "u1", riskLevel: "low" }).ok).toBe(true);
  });
});

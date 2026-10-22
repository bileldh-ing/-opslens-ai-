export const ROLES = ["viewer", "member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Every permission maps to the minimum role that holds it. Roles are strictly ordered. */
export const PERMISSIONS = {
  "workspace.read": "viewer",
  "incident.read": "viewer",
  "investigation.run": "member",
  "incident.write": "member",
  "logs.ingest": "member",
  "docs.upload": "member",
  "remediation.propose": "member",
  "remediation.approve": "admin",
  "member.invite": "admin",
  "project.manage": "admin",
  "audit.read": "admin",
  "integrations.manage": "admin",
  "evals.run": "admin",
  "incident.export": "member",
  "billing.manage": "owner",
  "org.delete": "owner",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return roleRank(role) >= roleRank(PERMISSIONS[permission]);
}

/** An inviter can only grant roles at or below their own, and never "owner". */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === "owner") return false;
  return can(actor, "member.invite") && roleRank(target) <= roleRank(actor);
}

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

export function assertCan(role: Role | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

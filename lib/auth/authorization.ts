import type { UserRole } from "@/lib/types";

export function hasRole(
    userRole: UserRole,
    allowedRoles: UserRole[],
): boolean {
    return allowedRoles.includes(userRole);
}

export function requireRole(
    userRole: UserRole,
    allowedRoles: UserRole[],
): void {
    if (!hasRole(userRole, allowedRoles)) {
        throw new Error("FORBIDDEN");
    }
}
import {
  type AccessScope,
  canAccessGroup,
  canDeletePage,
  canViewPage,
  createAccessScope,
  type GroupId,
  hasPermission,
  type Permission,
} from "../../lib/authorization"

type PermissionResult =
  | { readonly kind: "allowed" }
  | { readonly kind: "denied"; readonly reason: "permission" }

type GroupAccessResult = { readonly kind: "allowed" } | { readonly kind: "hidden" }

export const requirePermission = (
  scope: AccessScope,
  requiredPermission: Permission,
): PermissionResult =>
  hasPermission(scope, requiredPermission)
    ? { kind: "allowed" }
    : { kind: "denied", reason: "permission" }

export const requirePageDelete = (scope: AccessScope, path: string): PermissionResult =>
  canDeletePage(scope, path) ? { kind: "allowed" } : { kind: "denied", reason: "permission" }

export const requirePageView = (scope: AccessScope, path: string): PermissionResult =>
  canViewPage(scope, path) ? { kind: "allowed" } : { kind: "denied", reason: "permission" }

export const requireGroupAccess = (scope: AccessScope, groupId: GroupId): GroupAccessResult => {
  if (canAccessGroup(scope, groupId)) {
    return { kind: "allowed" }
  }
  return { kind: "hidden" }
}

export const createScopedAccess = createAccessScope

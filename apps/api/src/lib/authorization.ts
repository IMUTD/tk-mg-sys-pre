import { z } from "zod"

import {
  defaultPagesForRole,
  isAdminOnlyPath,
  isDeleteLockedPath,
  matchPageAccess,
  type PageAccess,
  permissionsForPages,
} from "./pages"

export const GroupIdSchema = z.string().uuid().brand<"GroupId">()

export type GroupId = z.infer<typeof GroupIdSchema>

export const UserIdSchema = z.string().uuid().brand<"UserId">()

export type UserId = z.infer<typeof UserIdSchema>

export const Permission = {
  ConfigurationWrite: "configuration:write",
  DevicesRead: "devices:read",
  DevicesWrite: "devices:write",
  OperationsRead: "operations:read",
  OperationsWrite: "operations:write",
  ResourcesRead: "resources:read",
  ResourcesWrite: "resources:write",
} as const

export const PermissionSchema = z.enum([
  Permission.ConfigurationWrite,
  Permission.DevicesRead,
  Permission.DevicesWrite,
  Permission.OperationsRead,
  Permission.OperationsWrite,
  Permission.ResourcesRead,
  Permission.ResourcesWrite,
])

export type Permission = z.infer<typeof PermissionSchema>

export const Role = {
  Administrator: "administrator",
  Engineer: "engineer",
  EngineeringDirector: "engineering_director",
  Operator: "operator",
  OperationsDirector: "operations_director",
  SalesDirector: "sales_director",
  Salesperson: "salesperson",
} as const

export const RoleSchema = z.enum([
  Role.Administrator,
  Role.Engineer,
  Role.EngineeringDirector,
  Role.Operator,
  Role.OperationsDirector,
  Role.SalesDirector,
  Role.Salesperson,
])

export type Role = z.infer<typeof RoleSchema>

export const ConfigurableRoleSchema = RoleSchema.exclude([Role.Administrator])
export type ConfigurableRole = z.infer<typeof ConfigurableRoleSchema>

export type AccessScope = {
  readonly restrictGroups?: boolean
  readonly groupIds: readonly GroupId[]
  readonly pages: readonly PageAccess[]
  readonly permissions: readonly Permission[]
  readonly role: Role
}

type AccessScopeInput = {
  readonly restrictGroups?: boolean
  readonly groupIds: readonly GroupId[]
  readonly pages?: readonly PageAccess[]
  readonly permissions?: readonly Permission[]
  readonly role: Role
}

export const createAccessScope = (input: AccessScopeInput): AccessScope => {
  const pages = input.pages ?? defaultPagesForRole(input.role)
  const permissions =
    input.permissions ?? PermissionSchema.array().parse(permissionsForPages(pages))
  return {
    ...(input.restrictGroups ? { restrictGroups: true } : {}),
    groupIds: input.groupIds,
    pages,
    permissions,
    role: input.role,
  }
}

export const hasPermission = (scope: AccessScope, permission: Permission): boolean =>
  scope.role === Role.Administrator || scope.permissions.includes(permission)

export const canAccessGroup = (scope: AccessScope, groupId: GroupId): boolean =>
  (scope.role === Role.Administrator && !scope.restrictGroups) || scope.groupIds.includes(groupId)

export const canViewPage = (scope: AccessScope, path: string): boolean => {
  if (isAdminOnlyPath(path)) return scope.role === Role.Administrator
  if (scope.role === Role.Administrator) return true
  return matchPageAccess(scope.pages, path)?.canView === true
}

export const canDeletePage = (scope: AccessScope, path: string): boolean => {
  if (isDeleteLockedPath(path)) return false
  if (scope.role === Role.Administrator) return true
  return matchPageAccess(scope.pages, path)?.canDelete === true
}

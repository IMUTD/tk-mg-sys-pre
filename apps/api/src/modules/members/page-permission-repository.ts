import type { Sql, TransactionSql } from "postgres"

import { ConfigurableRoleSchema, type Role, RoleSchema } from "../../lib/authorization"
import {
  defaultPagesForRole,
  mergePageAccess,
  PAGE_CATALOG,
  type PageAccess,
  type PageDefinition,
} from "../../lib/pages"
import type { MemberId } from "./repository"

export type StoredPageAccess = {
  readonly canDelete: boolean
  readonly canView: boolean
  readonly key: string
}

type PermissionRow = {
  readonly canDelete: boolean
  readonly canView: boolean
  readonly pageKey: string
}

export interface PagePermissionRepository {
  listCatalog(): readonly PageDefinition[]
  listForRole(role: Role): Promise<readonly PageAccess[]>
  listForUser(memberId: MemberId, role: Role): Promise<readonly PageAccess[]>
  replace(
    role: Exclude<Role, "administrator">,
    pages: readonly PageAccess[],
  ): Promise<readonly PageAccess[]>
  replaceForUser(
    memberId: MemberId,
    role: Role,
    pages: readonly PageAccess[],
  ): Promise<readonly PageAccess[]>
  seedForUser(memberId: MemberId, role: Role): Promise<readonly PageAccess[]>
}

const pageRecords = (pages: readonly PageAccess[]) =>
  pages.map((page) => ({
    can_delete: page.canDelete,
    can_view: page.canView,
    page_key: page.key,
  }))

const jsonRecords = (client: Sql | TransactionSql, pages: readonly PageAccess[]) =>
  client.json(pageRecords(pages))

const insertUserPages = async (
  client: Sql | TransactionSql,
  memberId: MemberId,
  pages: readonly PageAccess[],
): Promise<void> => {
  if (pages.length === 0) return
  await client`
    insert into user_page_permission (user_id, page_key, can_view, can_delete)
    select
      ${memberId}::uuid,
      t.page_key,
      t.can_view,
      t.can_delete
    from jsonb_to_recordset(${jsonRecords(client, pages)})
      as t(page_key text, can_view boolean, can_delete boolean)
  `
}

export const loadMergedPageAccess = async (
  client: Sql,
  role: Role,
  userId?: string,
): Promise<readonly PageAccess[]> => {
  if (role === "administrator") return mergePageAccess(role, [])
  if (userId !== undefined) {
    const userRows = await client<PermissionRow[]>`
      select
        page_key as "pageKey",
        can_view as "canView",
        can_delete as "canDelete"
      from user_page_permission
      where user_id = ${userId}
    `
    if (userRows.length > 0) {
      return mergePageAccess(
        role,
        userRows.map((row) => ({
          canDelete: row.canDelete,
          canView: row.canView,
          key: row.pageKey,
        })),
      )
    }
  }
  const rows = await client<(PermissionRow & { readonly role: string })[]>`
    select
      role,
      page_key as "pageKey",
      can_view as "canView",
      can_delete as "canDelete"
    from role_page_permission
    where role = ${role}
  `
  return mergePageAccess(
    role,
    rows.map((row) => ({ canDelete: row.canDelete, canView: row.canView, key: row.pageKey })),
  )
}

export const createPostgresPagePermissionRepository = (client: Sql): PagePermissionRepository => ({
  listCatalog: () => PAGE_CATALOG,
  listForRole: async (role) => loadMergedPageAccess(client, RoleSchema.parse(role)),
  listForUser: async (memberId, role) => {
    if (role !== "administrator") {
      const existing = await client<{ readonly pageKey: string }[]>`
        select page_key as "pageKey" from user_page_permission where user_id = ${memberId} limit 1
      `
      if (existing.length === 0) await insertUserPages(client, memberId, defaultPagesForRole(role))
    }
    return loadMergedPageAccess(client, role, memberId)
  },
  replace: async (role, pages) => {
    const parsedRole = ConfigurableRoleSchema.parse(role)
    await client.begin(async (transaction) => {
      await transaction`delete from role_page_permission where role = ${parsedRole}`
      if (pages.length > 0) {
        await transaction`
          insert into role_page_permission (role, page_key, can_view, can_delete)
          select
            ${parsedRole},
            t.page_key,
            t.can_view,
            t.can_delete
          from jsonb_to_recordset(${jsonRecords(transaction, pages)})
            as t(page_key text, can_view boolean, can_delete boolean)
        `
      }
    })
    return loadMergedPageAccess(client, parsedRole)
  },
  replaceForUser: async (memberId, role, pages) => {
    const sanitized = mergePageAccess(role, pages)
    await client.begin(async (transaction) => {
      await transaction`delete from user_page_permission where user_id = ${memberId}`
      await insertUserPages(transaction, memberId, sanitized)
      await transaction`
        update app_session
        set revoked_at = now()
        where user_id = ${memberId} and revoked_at is null
      `
    })
    return loadMergedPageAccess(client, role, memberId)
  },
  seedForUser: async (memberId, role) => {
    const pages = defaultPagesForRole(role)
    await client`delete from user_page_permission where user_id = ${memberId}`
    await insertUserPages(client, memberId, pages)
    return pages
  },
})

export const createInMemoryPagePermissionRepository = (): PagePermissionRepository => {
  const storedRoles = new Map<string, readonly StoredPageAccess[]>()
  const storedUsers = new Map<string, readonly StoredPageAccess[]>()
  return {
    listCatalog: () => PAGE_CATALOG,
    listForRole: async (role) => mergePageAccess(role, storedRoles.get(role) ?? []),
    listForUser: async (memberId, role) => {
      if (!storedUsers.has(memberId)) storedUsers.set(memberId, defaultPagesForRole(role))
      return mergePageAccess(role, storedUsers.get(memberId) ?? [])
    },
    replace: async (role, pages) => {
      storedRoles.set(role, pages)
      return mergePageAccess(role, pages)
    },
    replaceForUser: async (memberId, role, pages) => {
      const sanitized = mergePageAccess(role, pages)
      storedUsers.set(memberId, sanitized)
      return sanitized
    },
    seedForUser: async (memberId, role) => {
      const pages = defaultPagesForRole(role)
      storedUsers.set(memberId, pages)
      return pages
    },
  }
}

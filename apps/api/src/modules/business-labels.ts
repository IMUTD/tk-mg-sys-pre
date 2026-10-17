import { Hono } from "hono"
import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import { canDeletePage, canViewPage, hasPermission, Permission } from "../lib/authorization"
import { PageKey } from "../lib/pages"
import type { AuditRepository } from "./audit/service"
import { writeAuditEvent } from "./audit/service"
import type { AuthService } from "./auth/service"

export const administratorFor = async (
  sql: Sql | TransactionSql,
  userId: string,
): Promise<string | null> => {
  const rows = await sql<{ id: string }[]>`
    select a.id from app_user a
    where a.enabled and a.role = 'administrator' and a.provisioned_by = 'init-tool'
      and (a.id = ${userId}::uuid or exists (
        select 1 from user_group mine join user_group theirs on theirs.group_id = mine.group_id
        where mine.user_id = ${userId}::uuid and theirs.user_id = a.id
      ))
    order by (a.id = ${userId}::uuid) desc, a.id limit 1
  `
  return rows[0]?.id ?? null
}

const Scope = z.enum(["device", "account", "account-tag", "proxy", "resource", "registration"])
export type BusinessLabelScope = z.infer<typeof Scope>
const scopePages: Record<BusinessLabelScope, string> = {
  device: PageKey.Devices,
  account: PageKey.Accounts,
  "account-tag": PageKey.Accounts,
  proxy: PageKey.Proxies,
  resource: PageKey.StudioTextPool,
  registration: PageKey.StudioRegistration,
}
const scopeWritePermissions: Record<BusinessLabelScope, Permission> = {
  device: Permission.DevicesWrite,
  account: Permission.OperationsWrite,
  "account-tag": Permission.OperationsWrite,
  proxy: Permission.OperationsWrite,
  resource: Permission.ResourcesWrite,
  registration: Permission.ResourcesWrite,
}
const pageScopes: Record<string, readonly BusinessLabelScope[]> = {
  [PageKey.Devices]: ["device"],
  [PageKey.Accounts]: ["account", "account-tag", "proxy", "device"],
  [PageKey.AccountPool]: ["account", "account-tag", "device"],
  [PageKey.Tasks]: ["device"],
  [PageKey.Proxies]: ["proxy"],
  [PageKey.StudioRegistration]: ["registration"],
  [PageKey.StudioTextPool]: ["resource"],
}
const Kind = z.enum(["remark", "group"])
const Input = z.object({ kind: Kind, name: z.string().trim().min(1).max(40) })

export const registerBusinessLabels = (
  app: Hono,
  sql: Sql,
  authService: AuthService,
  auditRepository: AuditRepository,
): void => {
  const routes = new Hono<{
    Variables: { labelUser: string; labelCanDelete: boolean; labelScope: BusinessLabelScope }
  }>()
  routes.use("*", async (context, next) => {
    const cookie =
      /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(context.req.header("cookie") ?? "")?.[1] ?? ""
    const principal = await authService.session(cookie)
    if (principal === null) return context.json({ error: "authentication_required" }, 401)
    const page = context.req.query("page") ?? ""
    const allowedScopes = pageScopes[page]
    if (allowedScopes === undefined) return context.json({ error: "invalid_label_page" }, 400)
    const scope = Scope.safeParse(context.req.query("scope") ?? allowedScopes[0])
    if (!scope.success || !allowedScopes.includes(scope.data))
      return context.json({ error: "invalid_label_scope" }, 400)
    const sourcePage = scopePages[scope.data]
    if (
      !canViewPage(principal.scope, page) ||
      !canViewPage(principal.scope, sourcePage) ||
      (context.req.method === "POST" &&
        !hasPermission(principal.scope, scopeWritePermissions[scope.data])) ||
      (context.req.method === "DELETE" && principal.scope.role !== "administrator")
    ) {
      await writeAuditEvent(auditRepository, {
        action: "labels.access",
        actorId: principal.userId,
        outcome: "denied",
        target: context.req.path,
      })
      return context.json({ error: "permission_denied" }, 403)
    }
    if (
      context.req.method === "DELETE" &&
      (!canDeletePage(principal.scope, page) || !canDeletePage(principal.scope, sourcePage))
    )
      return context.json({ error: "permission_denied" }, 403)
    context.set("labelUser", principal.userId)
    context.set(
      "labelCanDelete",
      principal.scope.role === "administrator" &&
        canDeletePage(principal.scope, page) &&
        canDeletePage(principal.scope, sourcePage),
    )
    context.set("labelScope", scope.data)
    return next()
  })

  routes.get("/catalog", async (context) => {
    const administratorId = await administratorFor(sql, context.get("labelUser"))
    const scope = context.get("labelScope")
    const rows =
      administratorId === null
        ? []
        : await sql<
            {
              id: string
              administratorId: string
              name: string
              scope: BusinessLabelScope
              kind: "remark" | "group"
            }[]
          >`
      select id, administrator_id as "administratorId", name, kind, scope
      from business_label where administrator_id = ${administratorId}::uuid and scope = ${scope}
      order by name, id`
    return context.json({
      administratorId,
      scope,
      canDelete: context.get("labelCanDelete"),
      groups: rows.filter((row) => row.kind === "group"),
      remarks: rows.filter((row) => row.kind === "remark"),
    })
  })
  routes.post("/catalog", async (context) => {
    const input = Input.safeParse(await context.req.json().catch(() => null))
    if (!input.success) return context.json({ error: "invalid_label" }, 400)
    if (context.req.query("page") === PageKey.StudioRegistration && input.data.name.includes("+"))
      return context.json({ error: "invalid_label" }, 400)
    const administratorId = await administratorFor(sql, context.get("labelUser"))
    const scope = context.get("labelScope")
    if (administratorId === null) return context.json({ error: "permission_denied" }, 403)
    const rows = await sql`
      insert into business_label (administrator_id, scope, kind, name)
      values (${administratorId}::uuid, ${scope}, ${input.data.kind}, ${input.data.name})
      on conflict (administrator_id, scope, kind, name) do nothing
      returning id, administrator_id as "administratorId", scope, kind, name`
    if (rows.length === 0) return context.json({ error: "duplicate_label" }, 409)
    return context.json(rows[0], 201)
  })
  routes.delete("/catalog/:id", async (context) => {
    const id = z.string().uuid().safeParse(context.req.param("id"))
    if (!id.success) return context.json({ error: "invalid_id" }, 400)
    const administratorId = await administratorFor(sql, context.get("labelUser"))
    const scope = context.get("labelScope")
    if (administratorId === null) return context.json({ error: "not_found" }, 404)
    return sql.begin(async (tx) => {
      // Match the label-collection trigger's lock before reading usage.
      const identity = await tx<{ name: string; kind: string }[]>`
        select name, kind from business_label where id = ${id.data}::uuid
          and administrator_id = ${administratorId}::uuid and scope = ${scope}`
      if (identity[0] === undefined) return context.json({ error: "not_found" }, 404)
      await lockBusinessLabel(tx, administratorId, scope, identity[0].kind, identity[0].name)
      const rows = await tx<{ name: string; kind: string }[]>`
        select name, kind from business_label
        where id = ${id.data}::uuid and administrator_id = ${administratorId}::uuid
          and scope = ${scope} for update`
      const label = rows[0]
      if (label === undefined) return context.json({ error: "not_found" }, 404)
      if (
        scope === "device" &&
        (
          await tx`select 1 from device where box_group_id = ${id.data}::uuid
            union all select 1 from device_remark where label_id = ${id.data}::uuid
            limit 1`
        ).length > 0
      )
        return context.json({ error: "label_in_use" }, 409)
      if (
        scope === "resource" &&
        label.kind === "group" &&
        (await resourceCategoryInUse(tx, administratorId, label.name))
      )
        return context.json({ error: "label_in_use" }, 409)
      if (
        label.kind === "group" &&
        (await businessGroupInUse(tx, administratorId, scope, label.name))
      )
        return context.json({ error: "label_in_use" }, 409)
      if (
        label.kind === "remark" &&
        scope === "account" &&
        (await accountRemarkInUse(tx, administratorId, label.name))
      )
        return context.json({ error: "label_in_use" }, 409)
      if (
        label.kind === "remark" &&
        scope === "proxy" &&
        (await proxyRemarkInUse(tx, administratorId, label.name))
      )
        return context.json({ error: "label_in_use" }, 409)
      await tx`delete from business_label where id = ${id.data}::uuid`
      return context.body(null, 204)
    })
  })
  app.route("/api/labels", routes)
}

const accountRemarkInUse = async (
  sql: Sql | TransactionSql,
  administratorId: string,
  name: string,
): Promise<boolean> => {
  const rows = await sql`
    select 1 from operation_account a
    join user_group ug on ug.group_id = a.group_id
    where ug.user_id = ${administratorId}::uuid and exists (
      select 1
      from unnest(string_to_array(btrim(coalesce(a.note, '')), ${"\u001e"})) as part(name)
      where btrim(name) = ${name}
    )
    limit 1`
  return rows.length > 0
}

const resourceCategoryInUse = async (
  sql: Sql | TransactionSql,
  administratorId: string,
  name: string,
): Promise<boolean> => {
  const rows = await sql`
    select 1 from operation_resource r
    join user_group ug on ug.group_id = r.group_id
    where ug.user_id = ${administratorId}::uuid and btrim(r.category) = ${name}
    limit 1`
  return rows.length > 0
}

const proxyRemarkInUse = async (
  sql: Sql | TransactionSql,
  administratorId: string,
  name: string,
): Promise<boolean> => {
  const rows = await sql`
    select 1 from operation_proxy a
    join user_group ug on ug.group_id = a.group_id
    where ug.user_id = ${administratorId}::uuid and exists (
      select 1
      from unnest(string_to_array(btrim(coalesce(a.note, '')), ${"\u001e"})) as part(name)
      where btrim(name) = ${name}
    )
    limit 1`
  return rows.length > 0
}

export const businessGroupInUse = async (
  sql: Sql | TransactionSql,
  administratorId: string,
  scope: BusinessLabelScope,
  name: string,
): Promise<boolean> => {
  const rows = await sql`
    select 1 from (
      select group_id, tags[1:1] as tags, 'account' as scope from operation_account union all
      select group_id, tags[2:] as tags, 'account-tag' as scope from operation_account union all
      select group_id, tags, 'proxy' as scope from operation_proxy union all
      select group_id, tags, 'resource' as scope from operation_resource union all
      select group_id, tags, 'registration' as scope from registration_resource
    ) r join user_group ug on ug.group_id = r.group_id
    where ug.user_id = ${administratorId}::uuid and r.scope = ${scope}
      and ${name} = any(r.tags) limit 1`
  return rows.length > 0
}

export const lockBusinessLabel = async (
  sql: Sql | TransactionSql,
  administratorId: string,
  scope: BusinessLabelScope,
  kind: string,
  name: string,
): Promise<void> => {
  await sql`select pg_advisory_xact_lock(hashtextextended(
    ${`${administratorId}:${scope}:${kind}:${name}`}, 0))`
}

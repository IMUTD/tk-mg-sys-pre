import type { Sql } from "postgres"
import type { IdentityConfig } from "./config"
import { actorById, bindingByUser, requirePlatform, summary } from "./repository"
import type { ListQuery, PlatformIdentity } from "./types"

export const listIdentities = async (
  sql: Sql,
  config: IdentityConfig,
  actorId: string,
  query: ListQuery,
) => {
  requirePlatform(await actorById(sql, actorId))
  const filter = sql`from app_user u left join admin_identity_verification v on v.user_id=u.id where u.role='administrator' and u.provisioned_by='init-tool' ${query.q ? sql`and (u.email ilike ${`%${query.q}%`} or u.display_name ilike ${`%${query.q}%`})` : sql``} ${query.status ? sql`and coalesce(v.status,'unverified')=${query.status}` : sql``} ${query.from ? sql`and v.updated_at>=${query.from}` : sql``} ${query.to ? sql`and v.updated_at<=${query.to}` : sql``}`
  const totals = await sql<{ readonly total: number }[]>`select count(*)::int as total ${filter}`
  const rows = await sql<
    { readonly id: string }[]
  >`select u.id ${filter} order by u.created_at desc,u.id limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`
  const items: PlatformIdentity[] = []
  for (const row of rows) {
    const user = await actorById(sql, row.id)
    const binding = await bindingByUser(sql, row.id)
    items.push({
      ...summary(user, binding, config),
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      enabled: user.enabled,
    })
  }
  return { items, total: totals[0]?.total ?? 0, page: query.page, pageSize: query.pageSize }
}

export const listUnbindings = async (sql: Sql, actorId: string, userId: string) => {
  requirePlatform(await actorById(sql, actorId))
  await actorById(sql, userId)
  return sql<
    {
      readonly id: string
      readonly actorId: string
      readonly createdAt: Date
      readonly reason: string
    }[]
  >`select id,actor_id as "actorId",created_at as "createdAt",metadata->>'reason' as reason from audit_event where action='identity.unbind' and target=${userId} order by created_at desc limit 100`
}

import type { Sql } from "postgres"

/** 客户方：平台方在“客户管理”里建的管理员，名下的盒子管理员（一级用户）由他在初始化工具里建。 */
export type Customer = {
  readonly boxAdminCount: number
  readonly boxCount: number
  readonly createdAt: Date
  readonly displayName: string
  readonly email: string
  readonly enabled: boolean
  readonly groupId: string | null
  readonly id: string
}

export type CustomerCreateInput = {
  readonly displayName: string
  readonly email: string
  readonly passwordHash: string
  readonly platformUserId: string | null
}

export type CustomerUpdateInput = {
  readonly enabled?: boolean
  readonly passwordHash?: string
}

export type CustomerConflictCode = "email_taken" | "name_taken"

export class CustomerConflictError extends Error {
  public readonly code: CustomerConflictCode

  public constructor(code: CustomerConflictCode) {
    super(code)
    this.code = code
  }
}

export interface CustomerRepository {
  create(input: CustomerCreateInput): Promise<Customer>
  list(): Promise<readonly Customer[]>
  update(customerId: string, input: CustomerUpdateInput): Promise<Customer | null>
}

const constraintOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined
  const code = Object.getOwnPropertyDescriptor(error, "code")?.value
  if (code !== "23505") return undefined
  const name = Object.getOwnPropertyDescriptor(error, "constraint_name")?.value
  return typeof name === "string" ? name : undefined
}

export const createPostgresCustomerRepository = (client: Sql): CustomerRepository => {
  const select = (where: ReturnType<Sql>) => client<Customer[]>`
    select
      c.id,
      c.email,
      c.display_name as "displayName",
      c.enabled,
      c.created_at as "createdAt",
      own.group_id as "groupId",
      (
        select count(*)::int from app_user a
        where a.parent_user_id = c.id
          and a.role = 'administrator'
          and a.provisioned_by = 'init-tool'
          and a.email not like 'deleted+%'
      ) as "boxAdminCount",
      (
        select count(*)::int from device d
        join app_user a on a.id = d.assignee_user_id
        where a.parent_user_id = c.id
          and a.provisioned_by = 'init-tool'
          and d.external_id is not null
          and d.external_id <> ''
      ) as "boxCount"
    from app_user c
    left join lateral (
      -- 客户方还会加入名下盒子管理员的分组；自己的分组是没有其他管理员的那个。
      select ug.group_id from user_group ug
      where ug.user_id = c.id
        and not exists (
          select 1 from user_group other
          join app_user a on a.id = other.user_id
          where other.group_id = ug.group_id and a.id <> c.id and a.role = 'administrator'
        )
      limit 1
    ) own on true
    where c.is_customer and ${where}
    order by c.created_at, c.email
  `

  return {
    create: async (input) => {
      try {
        const id = await client.begin(async (sql) => {
          const userId = crypto.randomUUID()
          const groupId = crypto.randomUUID()
          // 客户方自己的分组用客户名命名；积分钱包按分组记账，客户方用这个分组充值和兑换。
          await sql`insert into access_group (id, name) values (${groupId}, ${input.displayName})`
          await sql`
            insert into app_user (
              id, email, display_name, password_hash, role, enabled,
              provisioned_by, is_customer, parent_user_id
            )
            values (
              ${userId}, ${input.email}, ${input.displayName}, ${input.passwordHash},
              'administrator', true, 'sys', true, ${input.platformUserId}
            )
          `
          await sql`insert into user_group (user_id, group_id) values (${userId}, ${groupId})`
          return userId
        })
        const [customer] = await select(client`c.id = ${id}`)
        if (customer === undefined) throw new Error("customer_not_persisted")
        return customer
      } catch (error) {
        const constraint = constraintOf(error)
        if (constraint?.startsWith("app_user_email") === true)
          throw new CustomerConflictError("email_taken")
        if (constraint?.startsWith("access_group_name") === true)
          throw new CustomerConflictError("name_taken")
        throw error
      }
    },
    list: () => select(client`true`),
    update: async (customerId, input) => {
      const found = await client.begin(async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select id from app_user where id = ${customerId} and is_customer for update
        `
        if (rows.length === 0) return false
        if (input.enabled !== undefined) {
          await sql`update app_user set enabled = ${input.enabled} where id = ${customerId}`
        }
        if (input.passwordHash !== undefined) {
          await sql`update app_user set password_hash = ${input.passwordHash} where id = ${customerId}`
        }
        // 停用或改密码后让旧登录失效（管理系统和初始化工具都要重新登录）。
        if (input.enabled === false || input.passwordHash !== undefined) {
          await sql`
            update app_session set revoked_at = now()
            where user_id = ${customerId} and revoked_at is null
          `
          await sql`delete from init_session where user_id = ${customerId}`
        }
        return true
      })
      if (!found) return null
      const [customer] = await select(client`c.id = ${customerId}`)
      return customer ?? null
    },
  }
}

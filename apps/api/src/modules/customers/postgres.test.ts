import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { createPostgresAuthRepository } from "../auth/postgres-repository"
import { CustomerConflictError, createPostgresCustomerRepository } from "./repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

// postgres.js 的查询要等到 then 才执行，包一层 async 让失败能被捕获。
const fails = async (run: () => Promise<unknown>): Promise<boolean> => {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

describe("createPostgresCustomerRepository", () => {
  databaseIntegrationTest(
    "creates a customer with its own group and counts the box administrators under it",
    async () => {
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      const platformId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      await client`
        insert into app_user (id, email, password_hash, role, is_platform)
        values (${platformId}, ${"platform@example.com"}, ${"h"}, ${Role.Administrator}, true)
      `
      const repository = createPostgresCustomerRepository(client)
      const customer = await repository.create({
        displayName: "客户甲",
        email: "customer@example.com",
        passwordHash: await Bun.password.hash("customer-pass"),
        platformUserId: platformId,
      })
      expect(customer.groupId).not.toBeNull()
      expect(customer.boxAdminCount).toBe(0)

      // 客户方在初始化工具里建的盒子管理员：自己的分组，客户方也加入这个分组。
      const boxAdminId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      const boxGroupId = "22222222-2222-4222-8222-222222222222"
      await client`insert into access_group (id, name) values (${boxGroupId}, ${"盒子管理员一"})`
      await client`
        insert into app_user (id, email, password_hash, role, provisioned_by, parent_user_id)
        values (${boxAdminId}, ${"box@example.com"}, ${"h"}, ${Role.Administrator}, ${"init-tool"}, ${customer.id})
      `
      await client`
        insert into user_group (user_id, group_id)
        values (${boxAdminId}, ${boxGroupId}), (${customer.id}, ${boxGroupId})
      `
      await client`
        insert into device (external_id, group_id, assignee_user_id, host, name, model)
        values (${"box-1"}, ${boxGroupId}, ${boxAdminId}, ${"10.0.0.1"}, ${"box-1"}, ${"box"})
      `
      const [listed] = await repository.list()
      expect(listed?.boxAdminCount).toBe(1)
      expect(listed?.boxCount).toBe(1)
      // 自己的分组仍然是创建时那个，不会因为加入了盒子管理员的分组而变。
      expect(listed?.groupId).toBe(customer.groupId)

      const auth =
        await createPostgresAuthRepository(client).findUserByEmail("customer@example.com")
      expect(auth?.scope.customer).toBe(true)
      expect(auth?.scope.restrictGroups).toBe(true)
      expect([...(auth?.scope.groupIds ?? [])].map(String).sort()).toEqual(
        [String(customer.groupId), boxGroupId].sort(),
      )
      expect(await Bun.password.verify("customer-pass", auth?.passwordHash ?? "")).toBe(true)

      await expect(
        (async () =>
          repository.create({
            displayName: "客户乙",
            email: "customer@example.com",
            passwordHash: "h",
            platformUserId: platformId,
          }))(),
      ).rejects.toBeInstanceOf(CustomerConflictError)
      const sameName = await fails(() =>
        repository.create({
          displayName: "客户甲",
          email: "other@example.com",
          passwordHash: "h",
          platformUserId: platformId,
        }),
      )
      expect(sameName).toBe(true)
    },
  )

  databaseIntegrationTest("disabling a customer revokes its sessions in both tools", async () => {
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    const repository = createPostgresCustomerRepository(client)
    const customer = await repository.create({
      displayName: "客户甲",
      email: "customer@example.com",
      passwordHash: "h",
      platformUserId: null,
    })
    await client`
      insert into app_session (id, user_id, token_hash, expires_at)
      values (${crypto.randomUUID()}, ${customer.id}, ${"hash"}, now() + interval '1 day')
    `
    await client`
      insert into init_session (token, user_id, expires_at)
      values (${"init-token"}, ${customer.id}, now() + interval '1 day')
    `
    const updated = await repository.update(customer.id, { enabled: false })
    expect(updated?.enabled).toBe(false)
    const [open] = await client<{ count: number }[]>`
      select count(*)::int as count from app_session
      where user_id = ${customer.id} and revoked_at is null
    `
    expect(open?.count).toBe(0)
    const [init] = await client<{ count: number }[]>`
      select count(*)::int as count from init_session where user_id = ${customer.id}
    `
    expect(init?.count).toBe(0)
    expect(await repository.update("dddddddd-dddd-4ddd-8ddd-dddddddddddd", { enabled: true })).toBe(
      null,
    )
  })

  databaseIntegrationTest("only lets non-platform system administrators be customers", async () => {
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    await client`
      insert into app_user (id, email, password_hash, role, provisioned_by)
      values
        (${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}, ${"a@example.com"}, ${"h"}, ${Role.Administrator}, ${"init-tool"}),
        (${"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}, ${"b@example.com"}, ${"h"}, ${Role.Operator}, ${"sys"})
    `
    expect(
      await fails(
        async () =>
          await client`update app_user set is_customer = true where email = ${"a@example.com"}`,
      ),
    ).toBe(true)
    expect(
      await fails(
        async () =>
          await client`update app_user set is_customer = true where email = ${"b@example.com"}`,
      ),
    ).toBe(true)
    await client`
      insert into app_user (id, email, password_hash, role, is_platform)
      values (${"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, ${"p@example.com"}, ${"h"}, ${Role.Administrator}, true)
    `
    expect(
      await fails(
        async () =>
          await client`update app_user set is_customer = true where email = ${"p@example.com"}`,
      ),
    ).toBe(true)
  })
})

import { describe, expect, it } from "bun:test"

import { type GroupId, GroupIdSchema, Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createInMemoryPagePermissionRepository } from "./page-permission-repository"
import {
  createInMemoryMemberRepository,
  type Member,
  MemberConflictError,
  type MemberCreateInput,
  type MemberRepository,
} from "./repository"
import { createMemberService } from "./service"

const ownGroup = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
const boxGroup = GroupIdSchema.parse("22222222-2222-4222-8222-222222222222")
const otherGroup = GroupIdSchema.parse("33333333-3333-4333-8333-333333333333")

/** 客户方带 isCustomer 标记；内存仓库本身不存这个字段，这里包一层补上，并记下建成员时的入参。 */
const setup = async () => {
  const base = createInMemoryMemberRepository()
  const customer = await base.create({
    displayName: "客户甲",
    email: "customer@example.com",
    groupIds: [ownGroup, boxGroup],
    passwordHash: "unused",
    role: Role.Administrator,
  })
  const boxAdmin = await base.create({
    displayName: "盒子管理员",
    email: "box-admin@example.com",
    groupIds: [boxGroup],
    passwordHash: "unused",
    role: Role.Administrator,
  })
  const mark = (member: Member | null): Member | null =>
    member?.id === customer.id ? { ...member, isCustomer: true } : member
  const created: MemberCreateInput[] = []
  const repository: MemberRepository = {
    ...base,
    create: async (input) => {
      created.push(input)
      return base.create(input)
    },
    get: async (memberId) => mark(await base.get(memberId)),
    list: async () => (await base.list()).map((member) => mark(member) ?? member),
  }
  const service = createMemberService({
    auditRepository: createInMemoryAuditRepository(),
    pagePermissions: createInMemoryPagePermissionRepository(),
    repository,
  })
  const create = (groupIds: readonly GroupId[], email = "child@example.com") =>
    service.create(customer.id, {
      email,
      groupIds: [...groupIds],
      password: "pw-123456",
      role: Role.Operator,
    })
  return { boxAdmin, create, created, customer }
}

const conflict = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof MemberConflictError ? error.code : "unexpected"
  }
}

describe("customer creating second-level members", () => {
  it("puts the member into the chosen box administrator's group under that administrator", async () => {
    const { boxAdmin, create, created } = await setup()
    const member = await create([boxGroup])
    expect(member.groupIds).toEqual([boxGroup])
    expect(member.role).toBe(Role.Operator)
    expect(created.at(-1)?.parentUserId).toBe(boxAdmin.id)
  })

  it("falls back to the customer as parent in its own group", async () => {
    const { create, created, customer } = await setup()
    const member = await create([ownGroup])
    expect(member.groupIds).toEqual([ownGroup])
    expect(created.at(-1)?.parentUserId).toBe(customer.id)
  })

  it("requires exactly one of the customer's own groups", async () => {
    const { create } = await setup()
    expect(await conflict(() => create([]))).toBe("invalid_group_ids")
    expect(await conflict(() => create([otherGroup]))).toBe("invalid_group_ids")
    expect(await conflict(() => create([ownGroup, boxGroup]))).toBe("invalid_group_ids")
  })
})

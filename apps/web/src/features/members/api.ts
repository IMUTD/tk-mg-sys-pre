import ky, { HTTPError } from "ky"
import { z } from "zod"

import { RoleSchema, resolveApiBaseUrl } from "../../lib/api/auth-api"

export const MemberSchema = z
  .object({
    createdAt: z.coerce.date(),
    displayName: z.string(),
    email: z.string().email(),
    enabled: z.boolean(),
    groupIds: z.array(z.string().uuid()).default([]),
    id: z.string().uuid(),
    role: RoleSchema,
  })
  .strict()
export type Member = z.infer<typeof MemberSchema>
export const MemberCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  email: z.string().email(),
  password: z.string(),
  role: RoleSchema,
})
export type MemberCreate = z.infer<typeof MemberCreateSchema>
export const MemberUpdateSchema = z.object({
  enabled: z.boolean(),
  password: z.string().optional(),
  role: RoleSchema,
})
export type MemberUpdate = z.infer<typeof MemberUpdateSchema>

export const PageDefinitionSchema = z.object({
  group: z.string(),
  key: z.string(),
  label: z.string(),
})
export const PageAccessSchema = z.object({
  canDelete: z.boolean(),
  canView: z.boolean(),
  key: z.string(),
})
export type PageAccess = z.infer<typeof PageAccessSchema>

const MEMBER_ERROR_MESSAGES: Record<string, string> = {
  cannot_configure_administrator: "管理员权限固定为全部页面，不能微调",
  cannot_delete_self: "不能删除当前登录账号",
  duplicate_email: "该账号已被使用",
  invalid_member_permissions: "请检查页面权限",
  invalid_member_request: "请检查账号、密码和角色",
  last_administrator: "至少保留一名启用中的管理员",
  member_in_use: "该成员有业务记录，无法删除，请改为停用",
  not_found: "成员不存在",
}

export const describeMemberError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    try {
      const body = z.object({ error: z.string() }).safeParse(await error.response.json())
      if (body.success) return MEMBER_ERROR_MESSAGES[body.data.error] ?? "成员操作失败"
    } catch {
      /* fall through */
    }
    if (error.response.status >= 500) return "成员权限写入失败，请重试"
    return "成员操作失败"
  }
  return "成员操作失败"
}

export interface MembersApi {
  create(input: MemberCreate): Promise<Member>
  delete(memberId: string): Promise<void>
  list(): Promise<readonly Member[]>
  listMemberPermissions(memberId: string): Promise<readonly PageAccess[]>
  listPages(): Promise<readonly z.infer<typeof PageDefinitionSchema>[]>
  replaceMemberPermissions(
    memberId: string,
    pages: readonly PageAccess[],
  ): Promise<readonly PageAccess[]>
  suggestDisplayName(exclude?: readonly string[]): Promise<string>
  update(memberId: string, input: MemberUpdate): Promise<Member>
}

const parseOrThrow = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    throw new Error(await describeMemberError(error))
  }
}

export const createMembersApi = (apiBaseUrl = "/api"): MembersApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    create: async (input) =>
      parseOrThrow(async () =>
        MemberSchema.parse(await client.post("members", { json: input }).json()),
      ),
    delete: async (memberId) =>
      parseOrThrow(async () => {
        await client.delete(`members/${encodeURIComponent(memberId)}`)
      }),
    list: async () =>
      parseOrThrow(
        async () =>
          z.object({ items: z.array(MemberSchema) }).parse(await client.get("members").json())
            .items,
      ),
    listMemberPermissions: async (memberId) =>
      parseOrThrow(
        async () =>
          z
            .object({ items: z.array(PageAccessSchema) })
            .parse(await client.get(`members/${encodeURIComponent(memberId)}/permissions`).json())
            .items,
      ),
    listPages: async () =>
      parseOrThrow(
        async () =>
          z
            .object({ items: z.array(PageDefinitionSchema) })
            .parse(await client.get("members/pages").json()).items,
      ),
    replaceMemberPermissions: async (memberId, pages) =>
      parseOrThrow(
        async () =>
          z
            .object({ items: z.array(PageAccessSchema) })
            .parse(
              await client
                .put(`members/${encodeURIComponent(memberId)}/permissions`, { json: { pages } })
                .json(),
            ).items,
      ),
    suggestDisplayName: async (exclude = []) =>
      parseOrThrow(
        async () =>
          z.object({ displayName: z.string().min(1) }).parse(
            await client
              .get("members/display-name", {
                searchParams: exclude.length === 0 ? {} : { exclude: exclude.join(",") },
              })
              .json(),
          ).displayName,
      ),
    update: async (memberId, input) =>
      parseOrThrow(async () =>
        MemberSchema.parse(
          await client.patch(`members/${encodeURIComponent(memberId)}`, { json: input }).json(),
        ),
      ),
  }
}

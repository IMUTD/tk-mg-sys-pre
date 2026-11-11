import ky, { HTTPError } from "ky"
import { z } from "zod"
import { resolveApiBaseUrl } from "../../lib/api/auth-api"
import { PageKey } from "../../lib/pages"

export type LabelKind = "remark" | "group"
const Scope = z.enum([
  "device",
  "account",
  "account-tag",
  "proxy",
  "resource",
  "registration",
  "behavior",
  "task-chain",
])
export type LabelScope = z.infer<typeof Scope>
export const labelScopeForPage = (page: string): LabelScope => {
  const scopes: Record<string, LabelScope> = {
    [PageKey.Devices]: "device",
    [PageKey.Tasks]: "device",
    [PageKey.Accounts]: "account",
    [PageKey.AccountPool]: "account",
    [PageKey.Proxies]: "proxy",
    [PageKey.StudioTextPool]: "resource",
    [PageKey.StudioRegistration]: "registration",
  }
  const scope = scopes[page]
  if (scope === undefined) throw new Error("Unsupported classification page")
  return scope
}
const Label = z.object({
  id: z.string().uuid(),
  administratorId: z.string().uuid(),
  lastAccount: z.string().optional(),
  name: z.string(),
  scope: Scope,
})
const Catalog = z.object({
  administratorId: z.string().uuid().nullable(),
  canDelete: z.boolean(),
  scope: Scope,
  groups: z.array(Label),
  remarks: z.array(Label),
})
export type BusinessLabel = z.infer<typeof Label>

export const labelsChanged = (): void => {
  window.dispatchEvent(new Event("business-labels-changed"))
}

export const createLabelsApi = () => {
  const client = ky.create({
    prefixUrl: resolveApiBaseUrl("/api", window.location.href),
    credentials: "include",
    retry: 0,
    timeout: 7000,
  })
  return {
    list: async (page: string, scope = labelScopeForPage(page)) => {
      const catalog = Catalog.parse(
        await client.get("labels/catalog", { searchParams: { page, scope } }).json(),
      )
      if (
        catalog.scope !== scope ||
        [...catalog.groups, ...catalog.remarks].some((label) => label.scope !== scope)
      )
        throw new Error("Unexpected classification scope")
      return catalog
    },
    create: async (page: string, kind: LabelKind, name: string, scope = labelScopeForPage(page)) =>
      Label.parse(
        await client
          .post("labels/catalog", {
            searchParams: { page, scope },
            json: { kind, name },
          })
          .json(),
      ),
    remove: async (page: string, id: string, scope = labelScopeForPage(page)) => {
      await client.delete(`labels/catalog/${id}`, { searchParams: { page, scope } })
    },
  }
}

export const labelError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = await error.response
      .json<{ error?: string }>()
      .catch(() => ({}) as { error?: string })
    if (body.error === "label_in_use") return "仍被业务数据使用的分组或备注不能删除"
    if (body.error === "duplicate_label") return "分类名称已存在"
    if (body.error === "permission_denied") return "没有分类管理权限"
  }
  return "分类操作失败，请稍后重试"
}

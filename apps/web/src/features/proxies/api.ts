import ky, { HTTPError } from "ky"
import { z } from "zod"
import { resolveApiBaseUrl } from "../../lib/api/auth-api"
import { type DetectOptions, emptyProxy, type MytProxy, type ProxyCheckResult } from "./myt-proxy"

const Configuration = z.object({
  protocol: z.enum(["http", "socks5", "v2"]),
  host: z.string(),
  port: z.number().int(),
  kind: z.enum(["static", "dynamic"]),
  save: z.boolean(),
  tun: z.boolean(),
  safe: z.boolean(),
  turbo: z.boolean(),
  acceleratorId: z.string().uuid().nullable(),
  acceleratorIds: z.array(z.string().uuid()),
  region: z.string(),
  expiredAt: z.string().nullable(),
  refreshUrl: z.string(),
  favorite: z.boolean(),
  v2Protocol: z.enum(["vmess", "vless"]).nullable(),
})
const RecordSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  displayId: z.number().int(),
  name: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  configuration: Configuration,
  credentialState: z.enum(["configured", "none"]),
  revision: z.number().int(),
  bindingCount: z.number().int(),
  checkResult: z.unknown().nullable(),
})
const PageSchema = z.object({ items: z.array(RecordSchema), total: z.number().int() })
const SecretSchema = z.object({
  username: z.string(),
  password: z.string(),
  extra: z.string(),
  refreshUrl: z.string().default(""),
})
type ApiProxy = z.infer<typeof RecordSchema>
const groupPath = (groupId: string): string =>
  `groups/${encodeURIComponent(groupId)}/operations/proxies`

export const mapProxyRecords = (records: readonly ApiProxy[]): MytProxy[] => {
  const byUuid = new Map(records.map((record) => [record.id, record.displayId]))
  return records.map((record) => {
    const config = record.configuration
    return {
      ...emptyProxy(record.displayId, record.createdAt),
      uuid: record.id,
      groupId: record.groupId,
      revision: record.revision,
      credentialState: record.credentialState,
      v2Protocol: config.v2Protocol,
      apiName: record.name,
      apiTags: record.tags,
      apiStatus: record.status,
      ip: config.host,
      port: String(config.port),
      type: config.protocol === "v2" ? "0" : config.protocol === "http" ? "1" : "2",
      proxyType: config.kind,
      save: config.save,
      tun: config.tun,
      safe: config.safe,
      turbo: config.turbo,
      turboNode: config.acceleratorId === null ? null : (byUuid.get(config.acceleratorId) ?? null),
      turboNodeList: config.acceleratorIds.flatMap((id) =>
        byUuid.has(id) ? [byUuid.get(id) ?? 0] : [],
      ),
      region: config.region,
      expiredTime: config.expiredAt,
      refreshUrl: config.refreshUrl,
      favorite: config.favorite,
      tag: record.tags[0] ?? "",
      remark: record.note,
      status: record.status !== "disabled",
      bindNumber: record.bindingCount,
      result: record.checkResult === null ? null : JSON.stringify(record.checkResult),
      updateTime: record.updatedAt,
    }
  })
}
export const proxyWriteInput = (
  record: MytProxy,
  records: readonly MytProxy[],
  includeCredentials = false,
): Record<string, unknown> => {
  const uuidFor = (id: number): string => {
    const node = records.find((item) => item.id === id && item.groupId === record.groupId)
    if (node?.uuid === undefined) throw new Error("加速节点不属于当前权限组")
    return node.uuid
  }
  const expiration =
    record.expiredTime === null
      ? null
      : new Date(record.expiredTime.replace(" ", "T")).toISOString()
  return {
    name: record.remark || record.apiName || record.ip || "V2",
    endpoint: `${record.ip.includes(":") ? `[${record.ip}]` : record.ip}:${record.port || "443"}`,
    note: record.remark,
    tags:
      record.tag === (record.apiTags?.[0] ?? "")
        ? (record.apiTags ?? [])
        : record.tag === ""
          ? []
          : [record.tag],
    status: record.status
      ? record.apiStatus === "unavailable"
        ? "unavailable"
        : "ready"
      : "disabled",
    ...(record.revision === undefined ? {} : { expectedRevision: record.revision }),
    configuration: {
      protocol: record.type === "0" ? "v2" : record.type === "1" ? "http" : "socks5",
      host: record.ip,
      port: Number(record.port || "443"),
      kind: record.proxyType,
      save: record.save,
      tun: record.tun,
      safe: record.safe,
      turbo: record.type === "0" || record.turbo,
      acceleratorId: record.turboNode === null ? null : uuidFor(record.turboNode),
      acceleratorIds: record.turboNodeList.map(uuidFor),
      region: record.region,
      expiredAt: expiration,
      refreshUrl: "",
      favorite: record.favorite,
      v2Protocol: record.v2Protocol ?? null,
    },
    ...(includeCredentials
      ? {
          credentials: JSON.stringify({
            username: record.username,
            password: record.password,
            extra: record.extra,
            refreshUrl: record.refreshUrl,
          }),
        }
      : {}),
  }
}
const Errors: Readonly<Record<string, string>> = {
  invalid_proxy_request: "请检查代理地址、端口、地区和有效期",
  invalid_proxy_host: "请输入有效的代理 IP 或域名",
  invalid_proxy_configuration: "代理配置无效",
  invalid_v2_configuration: "V2 配置无效，请使用 VMess/VLESS 链接或受支持的单一出站 JSON",
  unsupported_v2_transport: "暂不支持此 V2 传输方式",
  v2_credentials_required: "请填写 V2 扩展参数",
  invalid_accelerator: "加速节点不可用、属于其他权限组或被自身引用",
  accelerator_cycle: "加速节点不能构成循环",
  accelerator_chain_too_long: "加速链最多 8 层",
  accelerator_in_use: "加速节点正在被其他代理使用，请先解除关联",
  operation_entity_active: "代理正在被账号或任务使用，无法删除",
  proxy_probe_busy: "检测正在进行或请求过于频繁，请稍后重试",
  proxy_configuration_changed: "配置已改变，请重新检测或刷新后编辑",
  proxy_disabled: "代理已停用",
}
export const proxyRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = z
      .object({ error: z.string() })
      .safeParse(await error.response.json().catch(() => null))
    if (body.success) return Errors[body.data.error] ?? `请求失败：${body.data.error}`
  }
  return error instanceof Error ? error.message : "代理请求失败"
}
export interface ProxiesApi {
  list(groupIds: readonly string[]): Promise<MytProxy[]>
  credentials(record: MytProxy): Promise<MytProxy>
  save(record: MytProxy, records: readonly MytProxy[], withCredentials: boolean): Promise<MytProxy>
  delete(records: readonly MytProxy[]): Promise<void>
  detect(record: MytProxy, options: DetectOptions): Promise<ProxyCheckResult>
}
export const createProxiesApi = (apiBaseUrl = "/api"): ProxiesApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 40000,
  })
  const pathFor = (record: MytProxy): string => {
    if (record.groupId === undefined || record.uuid === undefined) throw new Error("代理尚未持久化")
    return `${groupPath(record.groupId)}/${encodeURIComponent(record.uuid)}`
  }
  return {
    list: async (groupIds) => {
      const records: ApiProxy[] = []
      for (const groupId of [...new Set(groupIds)]) {
        for (let page = 1; ; page++) {
          const result = PageSchema.parse(
            await client
              .get(groupPath(groupId), {
                searchParams: { page, pageSize: 100 },
              })
              .json(),
          )
          records.push(...result.items)
          if (page * 100 >= result.total) break
          if (page >= 1000) throw new Error("代理数量超出可加载范围")
        }
      }
      return mapProxyRecords([...new Map(records.map((record) => [record.id, record])).values()])
    },
    credentials: async (record) => ({
      ...record,
      ...SecretSchema.parse(await client.post(`${pathFor(record)}/credentials`).json()),
    }),
    save: async (record, records, withCredentials) => {
      if (record.groupId === undefined) throw new Error("没有可写的权限组")
      const input = proxyWriteInput(record, records, withCredentials)
      const response =
        record.uuid === undefined
          ? await client.post(groupPath(record.groupId), { json: input }).json()
          : await client.patch(pathFor(record), { json: input }).json()
      const saved = mapProxyRecords([RecordSchema.parse(response)])[0]
      if (saved === undefined) throw new Error("保存代理后未返回记录")
      return { ...saved, turboNode: record.turboNode, turboNodeList: record.turboNodeList }
    },
    delete: async (records) => {
      const groups = new Map<string, string[]>()
      for (const record of records) {
        if (record.groupId === undefined || record.uuid === undefined)
          throw new Error("代理尚未持久化")
        groups.set(record.groupId, [...(groups.get(record.groupId) ?? []), record.uuid])
      }
      for (const [groupId, ids] of groups) {
        for (let offset = 0; offset < ids.length; offset += 500)
          await client.post(`${groupPath(groupId)}/batch/delete`, {
            json: { ids: ids.slice(offset, offset + 500) },
          })
      }
    },
    detect: async (record, options) =>
      client.post(`${pathFor(record)}/detect`, { json: options }).json<ProxyCheckResult>(),
  }
}

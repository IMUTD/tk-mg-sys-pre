import { combineChecks, type FilterMode } from "../../components/tables/operation-controls"

export const CONFIG_KEY_OPTIONS = [
  {
    defaultUrl: "https://www.bingtop.com/ocr/upload/",
    label: "冰拓打码",
    value: "bingtop",
  },
  {
    defaultUrl: "http://192.168.1.101:8010/mbp",
    label: "云端储存",
    value: "minio",
  },
  {
    defaultUrl: "http://192.168.1.101:8010/yds_media",
    label: "云端储存(媒体)",
    value: "minio_media",
  },
  { defaultUrl: "", label: "代理账号", value: "proxy" },
  { defaultUrl: "", label: "喵提醒(喵码)", value: "miao_notify" },
  {
    defaultUrl: "keyword1,keyword2,keyword3",
    label: "自定义直连域名关键字",
    value: "direct_domain_keyword",
  },
  {
    defaultUrl: "keyword1,keyword2,keyword3",
    label: "自定义节流域名关键词",
    value: "turbo_domain_keyword",
  },
] as const

export type ConfigKey = (typeof CONFIG_KEY_OPTIONS)[number]["value"]

export type MytConfig = {
  createTime: string
  enable: boolean
  extra: string
  id: number
  key: ConfigKey | ""
  name: string
  password: string
  remark: string
  updateTime: string
  url: string
  userId: number
  username: string
}

export type ConfigQuery = {
  key: string
  name: string
  password: string
  remark: string
  username: string
}

const contains = (value: string, query: string): boolean =>
  query.trim().length === 0 || value.toLowerCase().includes(query.trim().toLowerCase())

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const configKeyOption = (key: string): (typeof CONFIG_KEY_OPTIONS)[number] | undefined =>
  CONFIG_KEY_OPTIONS.find((item) => item.value === key)

export const emptyConfigQuery = (): ConfigQuery => ({
  key: "",
  name: "",
  password: "",
  remark: "",
  username: "",
})

export const emptyConfig = (id: number, now: string): MytConfig => ({
  createTime: now,
  enable: true,
  extra: "",
  id,
  key: "",
  name: "",
  password: "",
  remark: "",
  updateTime: now,
  url: "",
  userId: 1,
  username: "",
})

export const applyConfigKey = (record: MytConfig, key: ConfigKey): MytConfig => {
  const option = configKeyOption(key)
  return {
    ...record,
    key,
    name: option?.label ?? record.name,
    url: option?.defaultUrl ?? "",
  }
}

export const filterConfigs = (
  configs: readonly MytConfig[],
  query: ConfigQuery,
  mode: FilterMode = "and",
): MytConfig[] =>
  configs
    .filter((item) =>
      combineChecks(mode, [
        query.name.length > 0 ? contains(item.name, query.name) : null,
        query.key.length > 0 ? contains(item.key, query.key) : null,
        query.username.length > 0 ? contains(item.username, query.username) : null,
        query.password.length > 0 ? contains(item.password, query.password) : null,
        query.remark.length > 0 ? contains(item.remark, query.remark) : null,
      ]),
    )
    .slice()
    .sort((left, right) => right.id - left.id)

export const createSeedConfigs = (): MytConfig[] => []

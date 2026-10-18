import type {
  AccountPoolsApi,
  DeskPoolQuery,
  PoolSource,
  PoolWrite,
  SourceFilter,
  StoredPoolDetails,
} from "../features/account-pool/api"
import {
  deskPoolKey,
  normalizeDeskQuery,
  resolveDeskPoolName,
} from "../features/account-pool/desk-pool"

export const poolTestGroup = "11111111-1111-4111-8111-111111111111"
export const poolTestDevice = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  name: "270-亮18",
  host: "192.168.76.130",
  serial: "simulation-device",
}
export const poolTestSources = (): PoolSource[] =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    deviceId: poolTestDevice.id,
    deviceSeq: 1,
    follower: 100 + index,
    following: 10,
    heart: 20,
    online: index % 2 === 0,
    playBeforeYesterday: 3,
    playToday: 5,
    playTotal: 1000,
    playYesterday: 4,
    proxyRemark: "",
    region: "US",
    remark: "模拟账号",
    status: "0",
    statisticsState: index === 0 ? "unavailable" : "stored",
    tag: index % 2 === 0 ? "亮2" : "亮3",
    tagBucket: [index % 2 === 0 ? "标签A" : "标签B"],
    transferred: false,
    uid: index === 0 ? "184992211" : `SIM-${index + 1}`,
    updateTime: "2026-10-08T00:00:00.000Z",
    username: index === 0 ? "user.alpha" : `simulation.${index + 1}`,
    videoPlays: [5, 4, 3],
  }))

export const poolTestFilter = (): SourceFilter => ({
  backType: "2",
  deviceId: poolTestDevice.id,
  deviceSeq: null,
  online: null,
  status: "",
  tag: [],
  tagInclude: [],
  tagExclude: [],
  tagQueryMode: "AND",
})

export const poolTestDetails = (
  displayId = 101,
  key = "1107发布",
  accounts = poolTestSources().slice(0, 2),
  filter: SourceFilter | null = poolTestFilter(),
  times = 2,
): StoredPoolDetails => ({
  id: `cccccccc-cccc-4ccc-8ccc-${String(displayId).padStart(12, "0")}`,
  displayId,
  groupId: poolTestGroup,
  createdByUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  createdByName: "操作员",
  key,
  remark: displayId === 103 ? "测试池" : "发布任务池",
  backType: filter?.backType ?? "2",
  deviceId: filter?.deviceId ?? poolTestDevice.id,
  deviceSeq: filter?.deviceSeq ?? null,
  deviceLabel: `${poolTestDevice.host}-${poolTestDevice.name}`,
  times,
  count: accounts.length,
  filterCondition: filter,
  createdAt: new Date("2026-10-08T00:00:00.000Z"),
  updatedAt: new Date("2026-10-08T00:00:00.000Z"),
  expiresAt: new Date("2026-11-07T00:00:00.000Z"),
  accounts,
  progress: Array.from({ length: times }, (_, index) => ({
    round: index + 1,
    key: `${key}_${index + 1}`,
    size: index === 0 ? Math.max(0, accounts.length - 1) : accounts.length,
    total: accounts.length,
    unusedAccountIds: (index === 0 ? accounts.slice(1) : accounts).map((item) => item.id),
  })),
})

// Test-only API state persists across page remounts, independently of React state.
export const createPoolTestApi = () => {
  let pools = [
    poolTestDetails(),
    poolTestDetails(102, "1107养号"),
    {
      ...poolTestDetails(103, "gen-1108测试", poolTestSources().slice(0, 2), null),
      createdByName: "千寻",
    },
  ]
  const writes: PoolWrite[] = []
  const matches = (account: PoolSource, filter: SourceFilter) =>
    !account.transferred &&
    (filter.deviceId === null || filter.deviceId === account.deviceId) &&
    (filter.deviceSeq === null || filter.deviceSeq === account.deviceSeq) &&
    (filter.tag.length === 0 || filter.tag.includes(account.tag)) &&
    (filter.online === null || filter.online === account.online) &&
    (filter.status === "" || filter.status === account.status) &&
    (filter.tagInclude.length === 0 ||
      (filter.tagQueryMode === "AND"
        ? filter.tagInclude.every((tag) => account.tagBucket.includes(tag))
        : filter.tagInclude.some((tag) => account.tagBucket.includes(tag)))) &&
    !filter.tagExclude.some((tag) => account.tagBucket.includes(tag))
  const api: AccountPoolsApi = {
    list: async (_groupId, query) => {
      const found = pools
        .filter((pool) => {
          const needle = query.key.trim().toLowerCase()
          return (
            String(pool.displayId).includes(query.id) &&
            (needle.length === 0 ||
              pool.key.toLowerCase().includes(needle) ||
              pool.createdByName.toLowerCase().includes(needle)) &&
            pool.remark.includes(query.remark)
          )
        })
        .sort((left, right) => right.displayId - left.displayId)
      return {
        items: found.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        total: found.length,
        page: query.page,
        pageSize: query.pageSize,
      }
    },
    devices: async () => [poolTestDevice],
    sources: async (_groupId, filter, page = 1, pageSize = 10) => {
      const all = poolTestSources()
      const found = all.filter((item) => matches(item, filter))
      return {
        items: found.slice((page - 1) * pageSize, page * pageSize),
        total: found.length,
        groups: ["亮2", "亮3"].map((tag) => ({
          tag,
          total: all.filter((item) => item.tag === tag).length,
        })),
      }
    },
    create: async (_groupId, input) => {
      writes.push(input)
      const id = Math.max(...pools.map((pool) => pool.displayId), 103) + 1
      const members = poolTestSources().filter(
        (item) =>
          matches(item, input.filter) &&
          (input.mode === "all" || input.accountIds?.includes(item.id)),
      )
      const created = {
        ...poolTestDetails(
          id,
          input.key ?? `gen-${id}`,
          members,
          input.mode === "all" ? input.filter : null,
          input.times,
        ),
        remark: input.remark,
      }
      pools = [...pools, created]
      return created
    },
    createDesk: async (_groupId, query: DeskPoolQuery, name = "") => {
      const normalized = normalizeDeskQuery(query)
      const id = Math.max(...pools.map((pool) => pool.displayId), 103) + 1
      const created = {
        ...poolTestDetails(
          id,
          resolveDeskPoolName(deskPoolKey(normalized, { device: "", proxy: "" }), name),
          [],
          null,
          1,
        ),
        backType: "5" as const,
        count: 0,
        deviceId: null,
        deviceLabel: "",
        deviceSeq: null,
        filterCondition: { kind: "desk" as const, query: normalized },
        remark: "",
      }
      pools = [...pools, created]
      return created
    },
    details: async (_groupId, id) => {
      const item = pools.find((pool) => pool.id === id)
      if (item === undefined) throw new Error("missing test pool")
      return item
    },
    remove: async (_groupId, ids) => {
      pools = pools.filter((pool) => !ids.includes(pool.id))
    },
  }
  return { api, writes }
}

export const PageKey = {
  Overview: "/overview",
  MallRecords: "/mall/records",
  MallOrders: "/mall/orders",
  MallInvoices: "/mall/invoices",
  MallRedeem: "/mall/redeem",
  Devices: "/operations/devices",
  CloudPreview: "/operations/previews",
  Accounts: "/operations/accounts",
  AccountPool: "/operations/account-pool",
  OperationsRegistration: "/operations/registration",
  Tasks: "/operations/tasks",
  TaskRecords: "/operations/task-records",
  Proxies: "/operations/proxies",
  Configuration: "/operations/configuration",
  Storage: "/engineering/storage",
  Robots: "/engineering/robots",
  Behaviors: "/engineering/behaviors",
  StudioVideo: "/studio/video",
  StudioImage: "/studio/image",
  StudioText: "/studio/text",
  StudioTextPool: "/studio/text-pool",
  StudioVideoPool: "/studio/video-pool",
  StudioVideoResources: "/studio/video-resources",
  StudioShareVideo: "/studio/share-video",
  StudioBackupResources: "/studio/backup-resources",
  StudioImagePool: "/studio/image-pool",
  StudioRegistration: "/studio/registration",
  WorkLogs: "/work-logs",
  Members: "/members",
} as const

export type PageKey = (typeof PageKey)[keyof typeof PageKey]

export type PageGroup =
  | "概览"
  | "积分商场"
  | "运营中心"
  | "工程中心"
  | "制作中心"
  | "资源中心"
  | "系统"

export type PageDefinition = {
  readonly group: PageGroup
  readonly key: PageKey
  readonly label: string
}

export type PageAccess = {
  readonly canDelete: boolean
  readonly canView: boolean
  readonly key: PageKey
}

export type ConfigurableRole =
  | "engineer"
  | "engineering_director"
  | "operator"
  | "operations_director"
  | "sales_director"
  | "salesperson"

export const PAGE_CATALOG: readonly PageDefinition[] = [
  { group: "概览", key: PageKey.Overview, label: "运营概览" },
  { group: "积分商场", key: PageKey.MallRecords, label: "积分记录" },
  { group: "积分商场", key: PageKey.MallOrders, label: "我的订单" },
  { group: "积分商场", key: PageKey.MallInvoices, label: "发票申请" },
  { group: "积分商场", key: PageKey.MallRedeem, label: "兑换中心" },
  { group: "运营中心", key: PageKey.Devices, label: "盒子管理" },
  { group: "运营中心", key: PageKey.CloudPreview, label: "云机预览" },
  { group: "运营中心", key: PageKey.Accounts, label: "账号管理" },
  { group: "运营中心", key: PageKey.AccountPool, label: "账号池" },
  { group: "运营中心", key: PageKey.OperationsRegistration, label: "注册池" },
  { group: "运营中心", key: PageKey.Tasks, label: "任务列表" },
  { group: "运营中心", key: PageKey.TaskRecords, label: "任务记录" },
  { group: "运营中心", key: PageKey.Proxies, label: "代理管理" },
  { group: "运营中心", key: PageKey.StudioVideoPool, label: "视频数据" },
  { group: "工程中心", key: PageKey.Storage, label: "私有云储存" },
  { group: "工程中心", key: PageKey.Robots, label: "运营机器人" },
  { group: "工程中心", key: PageKey.Behaviors, label: "行为中心" },
  { group: "制作中心", key: PageKey.StudioVideo, label: "视频制作" },
  { group: "制作中心", key: PageKey.StudioImage, label: "图片制作" },
  { group: "制作中心", key: PageKey.StudioText, label: "文本制作" },
  { group: "资源中心", key: PageKey.StudioTextPool, label: "文本池" },
  { group: "资源中心", key: PageKey.StudioShareVideo, label: "视频池" },
  { group: "资源中心", key: PageKey.StudioImagePool, label: "图片池" },
  { group: "资源中心", key: PageKey.StudioBackupResources, label: "备份池" },
  { group: "资源中心", key: PageKey.StudioRegistration, label: "注册池" },
  { group: "系统", key: PageKey.WorkLogs, label: "工作日志" },
  { group: "系统", key: PageKey.Members, label: "成员与权限" },
]

export const ADMIN_ONLY_PAGE_KEYS: readonly PageKey[] = [PageKey.WorkLogs]
export const NO_DELETE_PAGE_KEYS: readonly PageKey[] = [PageKey.Overview, PageKey.WorkLogs]
export const LOCKED_PAGE_KEYS: readonly PageKey[] = ADMIN_ONLY_PAGE_KEYS

export const isAdminOnlyPath = (path: string): boolean =>
  ADMIN_ONLY_PAGE_KEYS.some((key) => path === key || path.startsWith(`${key}/`))

export const isDeleteLockedPath = (path: string): boolean =>
  NO_DELETE_PAGE_KEYS.some((key) => path === key || path.startsWith(`${key}/`))

const SALES_PAGES: readonly PageKey[] = [
  PageKey.MallRecords,
  PageKey.MallOrders,
  PageKey.MallInvoices,
  PageKey.MallRedeem,
]

const OPERATIONS_CORE_PAGES: readonly PageKey[] = [
  PageKey.Devices,
  PageKey.CloudPreview,
  PageKey.Accounts,
  PageKey.AccountPool,
  PageKey.OperationsRegistration,
  PageKey.Tasks,
  PageKey.TaskRecords,
  PageKey.Proxies,
]

const OPERATIONS_PAGES: readonly PageKey[] = OPERATIONS_CORE_PAGES

const ENGINEERING_CORE_PAGES: readonly PageKey[] = [
  PageKey.Storage,
  PageKey.Robots,
  PageKey.Behaviors,
]

const RESOURCE_PAGES: readonly PageKey[] = [
  PageKey.StudioVideo,
  PageKey.StudioImage,
  PageKey.StudioText,
  PageKey.StudioTextPool,
  PageKey.StudioVideoPool,
  PageKey.StudioShareVideo,
  PageKey.StudioBackupResources,
  PageKey.StudioImagePool,
  PageKey.StudioRegistration,
]

const OPERATOR_PAGES: readonly PageKey[] = [
  PageKey.Overview,
  ...OPERATIONS_CORE_PAGES,
  ...RESOURCE_PAGES,
]

const OPERATIONS_DIRECTOR_PAGES: readonly PageKey[] = [
  PageKey.Overview,
  ...OPERATIONS_PAGES,
  ...RESOURCE_PAGES,
]

const SALESPERSON_PAGES: readonly PageKey[] = [PageKey.Overview, ...SALES_PAGES, ...RESOURCE_PAGES]

const SALES_DIRECTOR_PAGES: readonly PageKey[] = [
  PageKey.Overview,
  ...SALES_PAGES,
  ...RESOURCE_PAGES,
]

const ENGINEER_PAGES: readonly PageKey[] = [
  PageKey.Overview,
  ...ENGINEERING_CORE_PAGES,
  ...RESOURCE_PAGES,
]

const ENGINEERING_DIRECTOR_PAGES: readonly PageKey[] = [
  PageKey.Overview,
  ...ENGINEERING_CORE_PAGES,
  ...RESOURCE_PAGES,
]

const includesPage = (pages: readonly PageKey[], key: PageKey): boolean => pages.includes(key)

const pagesForConfigurableRole = (role: ConfigurableRole): readonly PageKey[] => {
  switch (role) {
    case "engineer":
      return ENGINEER_PAGES
    case "engineering_director":
      return ENGINEERING_DIRECTOR_PAGES
    case "operator":
      return OPERATOR_PAGES
    case "operations_director":
      return OPERATIONS_DIRECTOR_PAGES
    case "sales_director":
      return SALES_DIRECTOR_PAGES
    case "salesperson":
      return SALESPERSON_PAGES
  }
}

const deletePagesForConfigurableRole = (role: ConfigurableRole): readonly PageKey[] => {
  switch (role) {
    case "engineer":
    case "operator":
    case "salesperson":
      return []
    case "engineering_director":
      return [...ENGINEERING_CORE_PAGES, ...RESOURCE_PAGES]
    case "operations_director":
      return [...OPERATIONS_PAGES, ...RESOURCE_PAGES]
    case "sales_director":
      return [...SALES_PAGES, ...RESOURCE_PAGES]
  }
}

const isPageKey = (value: string): value is PageKey =>
  PAGE_CATALOG.some((page) => page.key === value)

export const administratorPageAccess = (): readonly PageAccess[] =>
  PAGE_CATALOG.map((page) => ({
    canDelete: !NO_DELETE_PAGE_KEYS.includes(page.key),
    canView: true,
    key: page.key,
  }))

export const defaultPagesForRole = (role: string): readonly PageAccess[] => {
  if (role === "administrator") return administratorPageAccess()
  if (
    role === "engineer" ||
    role === "engineering_director" ||
    role === "operator" ||
    role === "operations_director" ||
    role === "sales_director" ||
    role === "salesperson"
  ) {
    const viewPages = pagesForConfigurableRole(role)
    const deletePages = deletePagesForConfigurableRole(role)
    return PAGE_CATALOG.map((page) => {
      if (ADMIN_ONLY_PAGE_KEYS.includes(page.key)) {
        return { canDelete: false, canView: false, key: page.key }
      }
      const canView = includesPage(viewPages, page.key)
      const canDelete =
        canView && !NO_DELETE_PAGE_KEYS.includes(page.key) && includesPage(deletePages, page.key)
      return { canDelete, canView, key: page.key }
    })
  }
  return PAGE_CATALOG.map((page) => ({ canDelete: false, canView: false, key: page.key }))
}

export const mergePageAccess = (
  role: string,
  stored: readonly {
    readonly canDelete: boolean
    readonly canView: boolean
    readonly key: string
  }[],
): readonly PageAccess[] => {
  if (role === "administrator") return administratorPageAccess()
  const defaults = defaultPagesForRole(role)
  if (stored.length === 0) return defaults
  const byKey = new Map(stored.filter((row) => isPageKey(row.key)).map((row) => [row.key, row]))
  return defaults.map((page) => {
    if (ADMIN_ONLY_PAGE_KEYS.includes(page.key)) {
      return { canDelete: false, canView: false, key: page.key }
    }
    const override = byKey.get(page.key)
    const canView = override?.canView ?? page.canView
    const canDelete =
      canView && !NO_DELETE_PAGE_KEYS.includes(page.key) && (override?.canDelete ?? page.canDelete)
    return { canDelete, canView, key: page.key }
  })
}

export const matchPageAccess = (
  pages: readonly PageAccess[],
  path: string,
): PageAccess | undefined =>
  pages
    .filter((page) => path === page.key || path.startsWith(`${page.key}/`))
    .reduce<PageAccess | undefined>(
      (longest, candidate) =>
        longest === undefined || candidate.key.length > longest.key.length ? candidate : longest,
      undefined,
    )

export const permissionsForPages = (pages: readonly PageAccess[]): readonly string[] => {
  const canView = (key: PageKey): boolean => pages.some((page) => page.key === key && page.canView)
  const permissions: string[] = []
  if (canView(PageKey.Members)) {
    permissions.push("configuration:write")
  }
  if (canView(PageKey.Devices)) {
    permissions.push("devices:read", "devices:write")
  }
  if (OPERATIONS_PAGES.some((key) => canView(key))) {
    permissions.push("operations:read")
  }
  if (
    [
      PageKey.Accounts,
      PageKey.AccountPool,
      PageKey.Tasks,
      PageKey.Proxies,
      PageKey.StudioTextPool,
    ].some((key) => canView(key))
  ) {
    permissions.push("operations:write")
  }
  if (RESOURCE_PAGES.some((key) => canView(key))) {
    permissions.push("resources:read", "resources:write")
  }
  return [...new Set(permissions)]
}

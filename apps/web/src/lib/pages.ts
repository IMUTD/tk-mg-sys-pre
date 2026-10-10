export const PageKey = {
  Overview: "/overview",
  MarketingDashboard: "/marketing/dashboard",
  MarketingAccounts: "/marketing/accounts",
  MarketingNodes: "/marketing/nodes",
  MarketingSales: "/marketing/sales",
  MarketingOps: "/marketing/ops",
  MallRecords: "/mall/records",
  MallOrders: "/mall/orders",
  MallInvoices: "/mall/invoices",
  MallRedeem: "/mall/redeem",
  Devices: "/operations/devices",
  Accounts: "/operations/accounts",
  AccountPool: "/operations/account-pool",
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
  StudioBackupResources: "/studio/backup-resources",
  StudioImagePool: "/studio/image-pool",
  StudioRegistration: "/studio/registration",
  WorkLogs: "/work-logs",
  Members: "/members",
} as const

export type PageKey = (typeof PageKey)[keyof typeof PageKey]

export type PageGroup =
  | "概览"
  | "营销中心"
  | "积分商场"
  | "运营中心"
  | "工程中心"
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
  readonly key: string
}

export const PAGE_CATALOG: readonly PageDefinition[] = [
  { group: "概览", key: PageKey.Overview, label: "运营概览" },
  { group: "营销中心", key: PageKey.MarketingDashboard, label: "营销面板" },
  { group: "营销中心", key: PageKey.MarketingAccounts, label: "账号市场" },
  { group: "营销中心", key: PageKey.MarketingNodes, label: "节点市场" },
  { group: "营销中心", key: PageKey.MarketingSales, label: "销售业绩" },
  { group: "营销中心", key: PageKey.MarketingOps, label: "运营业绩" },
  { group: "积分商场", key: PageKey.MallRecords, label: "积分记录" },
  { group: "积分商场", key: PageKey.MallOrders, label: "我的订单" },
  { group: "积分商场", key: PageKey.MallInvoices, label: "发票申请" },
  { group: "积分商场", key: PageKey.MallRedeem, label: "兑换中心" },
  { group: "运营中心", key: PageKey.Devices, label: "盒子管理" },
  { group: "运营中心", key: PageKey.Accounts, label: "账号管理" },
  { group: "运营中心", key: PageKey.AccountPool, label: "账号池" },
  { group: "运营中心", key: PageKey.Tasks, label: "任务列表" },
  { group: "运营中心", key: PageKey.TaskRecords, label: "任务记录" },
  { group: "运营中心", key: PageKey.Proxies, label: "代理管理" },
  { group: "运营中心", key: PageKey.Configuration, label: "配置中心" },
  { group: "工程中心", key: PageKey.Storage, label: "私有云储存" },
  { group: "工程中心", key: PageKey.Robots, label: "运营机器人" },
  { group: "工程中心", key: PageKey.Behaviors, label: "行为中心" },
  { group: "资源中心", key: PageKey.StudioVideo, label: "视频制作" },
  { group: "资源中心", key: PageKey.StudioImage, label: "图片制作" },
  { group: "资源中心", key: PageKey.StudioText, label: "文本制作" },
  { group: "资源中心", key: PageKey.StudioTextPool, label: "文本池" },
  { group: "资源中心", key: PageKey.StudioVideoPool, label: "视频池" },
  { group: "资源中心", key: PageKey.StudioVideoResources, label: "视频资源" },
  { group: "资源中心", key: PageKey.StudioBackupResources, label: "备份资源" },
  { group: "资源中心", key: PageKey.StudioImagePool, label: "图片池" },
  { group: "资源中心", key: PageKey.StudioRegistration, label: "注册池" },
  { group: "系统", key: PageKey.WorkLogs, label: "工作日志" },
  { group: "系统", key: PageKey.Members, label: "成员与权限" },
]

export const ROLE_LABELS: Record<string, string> = {
  administrator: "管理员",
  operations_director: "运营部长",
  operator: "运营员",
  sales_director: "销售部长",
  salesperson: "销售员",
  engineering_director: "工程部长",
  engineer: "工程师",
}

export const MEMBER_ROLE_OPTIONS = [
  { label: "运营员", value: "operator" },
  { label: "运营部长", value: "operations_director" },
  { label: "销售员", value: "salesperson" },
  { label: "销售部长", value: "sales_director" },
  { label: "工程师", value: "engineer" },
  { label: "工程部长", value: "engineering_director" },
  { label: "管理员", value: "administrator" },
] as const

export const CONFIGURABLE_ROLE_OPTIONS = MEMBER_ROLE_OPTIONS.filter(
  (option) => option.value !== "administrator",
)

const SALES_PAGES: readonly PageKey[] = [
  PageKey.MarketingDashboard,
  PageKey.MarketingAccounts,
  PageKey.MarketingNodes,
  PageKey.MarketingSales,
  PageKey.MarketingOps,
  PageKey.MallRecords,
  PageKey.MallOrders,
  PageKey.MallInvoices,
  PageKey.MallRedeem,
]

const OPERATIONS_CORE_PAGES: readonly PageKey[] = [
  PageKey.Devices,
  PageKey.Accounts,
  PageKey.AccountPool,
  PageKey.Tasks,
  PageKey.TaskRecords,
  PageKey.Proxies,
]

const OPERATIONS_PAGES: readonly PageKey[] = [...OPERATIONS_CORE_PAGES, PageKey.Configuration]

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
  PageKey.StudioVideoResources,
  PageKey.StudioBackupResources,
  PageKey.StudioImagePool,
  PageKey.StudioRegistration,
]

export const ADMIN_ONLY_PAGE_KEYS: readonly PageKey[] = [PageKey.WorkLogs]
export const NO_DELETE_PAGE_KEYS: readonly PageKey[] = [PageKey.Overview, PageKey.WorkLogs]

export const isAdminOnlyPath = (path: string): boolean =>
  ADMIN_ONLY_PAGE_KEYS.some((key) => path === key || path.startsWith(`${key}/`))

export const isDeleteLockedPath = (path: string): boolean =>
  NO_DELETE_PAGE_KEYS.some((key) => path === key || path.startsWith(`${key}/`))

export const allowPageDelete = (canDelete?: boolean): boolean => canDelete === true

const viewPagesByRole: Record<string, readonly PageKey[]> = {
  engineer: [PageKey.Overview, ...ENGINEERING_CORE_PAGES, ...RESOURCE_PAGES],
  engineering_director: [PageKey.Overview, ...ENGINEERING_CORE_PAGES, ...RESOURCE_PAGES],
  operator: [PageKey.Overview, ...OPERATIONS_CORE_PAGES, ...RESOURCE_PAGES],
  operations_director: [
    PageKey.Overview,
    ...OPERATIONS_PAGES,
    PageKey.MarketingOps,
    ...RESOURCE_PAGES,
  ],
  sales_director: [PageKey.Overview, ...SALES_PAGES, ...RESOURCE_PAGES],
  salesperson: [PageKey.Overview, ...SALES_PAGES, ...RESOURCE_PAGES],
}

const deletePagesByRole: Record<string, readonly PageKey[]> = {
  engineer: [],
  engineering_director: [...ENGINEERING_CORE_PAGES, ...RESOURCE_PAGES],
  operator: [],
  operations_director: [...OPERATIONS_PAGES, PageKey.MarketingOps, ...RESOURCE_PAGES],
  sales_director: [...SALES_PAGES, ...RESOURCE_PAGES],
  salesperson: [],
}

export const defaultPagesForRole = (role: string): readonly PageAccess[] => {
  if (role === "administrator") {
    return PAGE_CATALOG.map((page) => ({
      canDelete: !NO_DELETE_PAGE_KEYS.includes(page.key),
      canView: true,
      key: page.key,
    }))
  }
  const viewPages = viewPagesByRole[role] ?? []
  const deletePages = deletePagesByRole[role] ?? []
  return PAGE_CATALOG.map((page) => {
    if (ADMIN_ONLY_PAGE_KEYS.includes(page.key)) {
      return { canDelete: false, canView: false, key: page.key }
    }
    const canView = viewPages.includes(page.key)
    return {
      canDelete:
        canView && !NO_DELETE_PAGE_KEYS.includes(page.key) && deletePages.includes(page.key),
      canView,
      key: page.key,
    }
  })
}

const pagesForUser = (
  role: string,
  pages: readonly PageAccess[] | undefined,
): readonly PageAccess[] =>
  pages !== undefined && pages.length > 0 ? pages : defaultPagesForRole(role)

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

export const canViewPage = (role: string, path: string, pages?: readonly PageAccess[]): boolean => {
  if (isAdminOnlyPath(path)) return role === "administrator"
  if (role === "administrator") return true
  return matchPageAccess(pagesForUser(role, pages), path)?.canView === true
}

export const canDeletePage = (
  role: string,
  path: string,
  pages?: readonly PageAccess[],
): boolean => {
  if (isDeleteLockedPath(path)) return false
  if (role === "administrator") return true
  return matchPageAccess(pagesForUser(role, pages), path)?.canDelete === true
}

export const firstAccessiblePath = (role: string, pages?: readonly PageAccess[]): string => {
  if (role === "administrator") return PageKey.Overview
  const accessible = pagesForUser(role, pages).find((page) => page.canView)
  return accessible?.key ?? PageKey.Overview
}

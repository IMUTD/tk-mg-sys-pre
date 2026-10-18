import type { MarketAccount, MarketNode, OpsRow, SalesRow, TrendPoint } from "./catalog"

const account = (id: number, overrides: Partial<MarketAccount>): MarketAccount => ({
  followers: 0,
  id,
  lastActive: "2026-09-17 12:00:00",
  operator: "林小满",
  platform: "TikTok",
  price: 100,
  region: "美国",
  sku: `ACC-${id}`,
  status: "stock",
  type: "white",
  windowed: false,
  ...overrides,
})

export const createAccountFixtures = (): MarketAccount[] => [
  account(1, { sku: "ACC-W-001" }),
  account(2, { region: "日本", sku: "ACC-W-118" }),
  account(3, { sku: "ACC-M-009", type: "month-white" }),
  account(4, { followers: 1200, sku: "ACC-K-008", type: "kilo", windowed: true }),
  account(5, { followers: 2000, sku: "ACC-K-077", status: "sold", type: "kilo", windowed: true }),
  account(6, { region: "英国", sku: "ACC-O-003", type: "windowed", windowed: true }),
]

export const createNodeFixtures = (): MarketNode[] => [
  {
    bandwidth: "100Mbps",
    id: 1,
    name: "美东住宅 A",
    price: 50,
    region: "美国",
    status: "stock",
    stock: 10,
    type: "residential",
  },
  {
    bandwidth: "100Mbps",
    id: 2,
    name: "美西机房",
    price: 30,
    region: "美国",
    status: "stock",
    stock: 20,
    type: "datacenter",
  },
  {
    bandwidth: "50Mbps",
    id: 3,
    name: "伦敦移动",
    price: 40,
    region: "英国",
    status: "soldout",
    stock: 0,
    type: "mobile",
  },
  {
    bandwidth: "50Mbps",
    id: 4,
    name: "东京住宅",
    price: 45,
    region: "日本",
    status: "stock",
    stock: 15,
    type: "residential",
  },
]

export const createSalesFixtures = (): SalesRow[] => [
  { account: 42000, deals: 38, id: 1, name: "林小满", node: 12400, refund: 1000, system: 21000 },
  { account: 31000, deals: 27, id: 2, name: "陈北", node: 9000, refund: 600, system: 15000 },
  { account: 19600, deals: 18, id: 3, name: "周启", node: 5700, refund: 400, system: 9200 },
]

export const createOpsFixtures = (): OpsRow[] => [
  {
    id: 1,
    kiloLeft: 5,
    name: "陈北",
    remaining: 36,
    scrap: 10,
    sold: 54,
    total: 100,
    windowedLeft: 4,
  },
  {
    id: 2,
    kiloLeft: 2,
    name: "周启",
    remaining: 10,
    scrap: 5,
    sold: 35,
    total: 50,
    windowedLeft: 3,
  },
]

export const createTrendFixtures = (): TrendPoint[] => [
  { account: 1200, label: "周一", node: 300, system: 500 },
  { account: 1800, label: "周二", node: 400, system: 700 },
]

import type { MallApi, MallProduct } from "./api"
import type { PointRecord, ShopOrder } from "./catalog"

export const createPointFixtures = (): PointRecord[] => [
  {
    balance: 59900,
    delta: -100,
    id: "point-2",
    remark: "注册GG",
    taskId: "task-2",
    time: "2026-09-17 12:00:00",
    type: "spend",
  },
  {
    balance: 60000,
    delta: 60000,
    id: "point-1",
    remark: "积分充值6W",
    taskId: "",
    time: "2026-09-17 11:00:00",
    type: "recharge",
  },
]

export const createOrderFixtures = (): ShopOrder[] => [
  {
    createdAt: "2026-09-17 11:00:00",
    deduction: "¥0",
    delivery: "待交付",
    description: "全球动态200G30天",
    finalPrice: "¥200",
    id: "order-1",
    orderNo: "ORDER-001",
    paidAt: "",
    product: "全球动态200G30天",
    status: "unpaid",
    title: "资源购买",
    total: "¥200",
    type: "resource",
  },
  {
    createdAt: "2026-09-17 10:00:00",
    deduction: "¥0",
    delivery: "已到账",
    description: "积分充值6W",
    finalPrice: "¥600",
    id: "order-2",
    orderNo: "ORDER-002",
    paidAt: "2026-09-17 10:01:00",
    product: "积分充值6W",
    status: "paid",
    title: "积分充值",
    total: "¥600",
    type: "points",
  },
]

export const mallGroupId = "11111111-1111-4111-8111-111111111111"

export const createProductFixtures = (): MallProduct[] => [
  {
    createdAt: "2026-09-17T00:00:00.000Z",
    enabled: true,
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "account",
    minQuantity: 2,
    name: "日本满季度白号",
    pricePoints: 5000,
    spec: "100 个起售",
    stock: 100,
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    createdAt: "2026-09-17T00:00:00.000Z",
    enabled: true,
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    kind: "proxy",
    minQuantity: 1,
    name: "全球动态住宅",
    pricePoints: 20000,
    spec: "200G / 30 天",
    stock: 12,
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    createdAt: "2026-09-17T00:00:00.000Z",
    enabled: true,
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    kind: "proxy",
    minQuantity: 1,
    name: "售罄代理",
    pricePoints: 100,
    spec: "",
    stock: 0,
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
]

export const createMallApiFixture = (overrides: Partial<MallApi> = {}): MallApi => ({
  createInvoice: async () => {
    throw new Error("not used")
  },
  createRecharge: async () => ({
    amountCents: 10000,
    orderNo: "A1",
    payUrl: "https://gateway.invalid/pay",
    points: 10000,
    status: "unpaid",
  }),
  invoiceFileUrl: () => "/api/file",
  invoiceQuota: async () => ({ availableCents: 10000, invoicedCents: 0, paidCents: 10000 }),
  invoices: async () => ({ items: [], total: 0 }),
  paymentConfig: async () => ({ alipay: false }),
  rechargeStatus: async () => ({
    amountCents: 10000,
    orderNo: "A1",
    points: 10000,
    status: "paid",
  }),
  ledger: async () => {
    const items = createPointFixtures()
    return { items, total: items.length }
  },
  orderItems: async () => [
    { id: "dddddddd-0000-4000-8000-000000000001", kind: "account", name: "jp_white_001" },
  ],
  orders: async () => {
    const items = createOrderFixtures()
    return { items, total: items.length }
  },
  products: async () => createProductFixtures(),
  purchase: async () => ({ balance: 49900, orderNo: "M1", points: 10000 }),
  wallets: async () => [{ balance: 59900, groupId: mallGroupId, name: "一组" }],
  ...overrides,
})

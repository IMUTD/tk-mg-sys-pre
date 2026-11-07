import type { MallApi } from "./api"
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
    deduction: 0,
    delivery: "待交付",
    description: "全球动态200G30天",
    finalPrice: 200,
    id: "order-1",
    orderNo: "ORDER-001",
    paidAt: "",
    product: "全球动态200G30天",
    status: "unpaid",
    title: "资源购买",
    total: 200,
    type: "resource",
  },
  {
    createdAt: "2026-09-17 10:00:00",
    deduction: 0,
    delivery: "已到账",
    description: "积分充值6W",
    finalPrice: 600,
    id: "order-2",
    orderNo: "ORDER-002",
    paidAt: "2026-09-17 10:01:00",
    product: "积分充值6W",
    status: "paid",
    title: "积分充值",
    total: 600,
    type: "points",
  },
]

export const mallGroupId = "11111111-1111-4111-8111-111111111111"

export const createMallApiFixture = (overrides: Partial<MallApi> = {}): MallApi => ({
  ledger: async () => {
    const items = createPointFixtures()
    return { items, total: items.length }
  },
  orders: async () => {
    const items = createOrderFixtures()
    return { items, total: items.length }
  },
  wallets: async () => [{ balance: 59900, groupId: mallGroupId, name: "一组" }],
  ...overrides,
})

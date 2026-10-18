import type { PointRecord, RedeemProduct, ShopOrder } from "./catalog"

export const createPointFixtures = (): PointRecord[] => [
  {
    balance: 59900,
    delta: -100,
    id: 2,
    remark: "注册GG",
    taskId: "task-2",
    time: "2026-09-17 12:00:00",
    type: "spend",
  },
  {
    balance: 60000,
    delta: 60000,
    id: 1,
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
    id: 1,
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
    id: 2,
    orderNo: "ORDER-002",
    paidAt: "2026-09-17 10:01:00",
    product: "积分充值6W",
    status: "paid",
    title: "积分充值",
    total: 600,
    type: "points",
  },
]

export const createProductFixtures = (): RedeemProduct[] => [
  {
    id: 1,
    limit: 1,
    name: "日本满季度白号100个",
    points: 5000,
    stockLabel: "库存充足",
    tag: "账号",
  },
  { id: 2, limit: 2, name: "美区住宅节点", points: 1000, stockLabel: "库存充足", tag: "节点" },
]

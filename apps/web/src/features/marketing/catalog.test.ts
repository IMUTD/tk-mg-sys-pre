import { describe, expect, it } from "vitest"

import {
  applyAccountOffer,
  applyNodeOffer,
  createSeedAccounts,
  createSeedNodes,
  createSeedOps,
  createSeedSales,
  dashboardKpis,
  emptyAccountQuery,
  emptyNodeQuery,
  filterAccounts,
  filterNodes,
  netSales,
  soldRate,
  validatePrice,
} from "./catalog"

describe("marketing catalog", () => {
  it("computes remaining inventory, net sales and ticket size", () => {
    const kpis = dashboardKpis(createSeedAccounts(), createSeedSales())

    expect(kpis.accountSales).toBe(92_600)
    expect(kpis.nodeSales).toBe(27_100)
    expect(kpis.systemSales).toBe(45_200)
    expect(kpis.windowedLeft).toBe(2)
    expect(kpis.monthWhiteLeft).toBe(1)
    expect(kpis.whiteLeft).toBe(2)
    expect(kpis.kiloLeft).toBe(1)
    expect(kpis.deals).toBe(83)
    expect(kpis.net).toBe(162_900)
    expect(kpis.ticket).toBe(1963)
  })

  it("filters accounts by type, region and windowed flag", () => {
    const accounts = createSeedAccounts()
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), type: "white" }).map((item) => item.sku),
    ).toEqual(["ACC-W-001", "ACC-W-118"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), region: "美国", windowed: "yes" }).map(
        (item) => item.sku,
      ),
    ).toEqual(["ACC-K-008", "ACC-K-077"])
  })

  it("filters nodes and ranks sales and ops metrics", () => {
    const soldOut = filterNodes(createSeedNodes(), { ...emptyNodeQuery(), status: "soldout" })
    expect(soldOut.map((item) => item.name)).toEqual(["伦敦移动"])

    const topSales = createSeedSales()
      .slice()
      .sort((left, right) => netSales(right) - netSales(left))[0]
    if (topSales === undefined) throw new Error("missing sales")
    expect(topSales.name).toBe("林小满")
    expect(netSales(topSales)).toBe(74_400)

    const ops = createSeedOps().find((item) => item.name === "陈北")
    if (ops === undefined) throw new Error("missing ops")
    expect(soldRate(ops)).toBe(54)
  })

  it("updates only windowed, price and status on a listing", () => {
    const account = createSeedAccounts()[0]
    if (account === undefined) throw new Error("missing account")
    const nextAccount = applyAccountOffer(account, {
      price: 200,
      status: "reserved",
      windowed: true,
    })
    expect(nextAccount).toMatchObject({
      followers: account.followers,
      operator: account.operator,
      price: 200,
      region: account.region,
      sku: account.sku,
      status: "reserved",
      windowed: true,
    })

    const node = createSeedNodes()[0]
    if (node === undefined) throw new Error("missing node")
    const nextNode = applyNodeOffer(node, { price: 48, status: "soldout" })
    expect(nextNode.bandwidth).toBe(node.bandwidth)
    expect(nextNode.name).toBe(node.name)
    expect(nextNode.price).toBe(48)
    expect(nextNode.status).toBe("soldout")
    expect(validatePrice(-1)).toBe("请填写有效价格")
  })
})

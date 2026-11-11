import { describe, expect, it } from "vitest"

import { matchBehavior, matchTaskChain } from "./chain-filter"
import { type BehaviorChain, type ChainStep, createStep } from "./rpa-api"

const chain = (patch: Partial<BehaviorChain> & Pick<BehaviorChain, "name">): BehaviorChain => ({
  anchor: null,
  id: patch.name,
  lastTestAt: "",
  origin: "rpa",
  remarks: [],
  steps: [createStep("OpenApp", 1)],
  updateTime: "",
  ...patch,
})

const open = (name: string, steps: readonly ChainStep[] = [createStep("OpenApp", 1)]) => ({
  name,
  stages: [{ chainName: "登录", steps }],
})

describe("chain filters", () => {
  it("keeps every behavior chain when the card is idle", () => {
    const idle = {
      account: "",
      apis: [],
      keyword: "",
      mode: "and",
      origin: "",
      remarks: [],
      tested: "",
    } as const
    expect(matchBehavior(chain({ name: "早班" }), idle)).toBe(true)
  })

  it("combines origin, account and keyword with the selected mode", () => {
    const target = chain({
      anchor: { key: "identifier", table: "operation_account" },
      name: "早班养号",
      origin: "ai",
    })
    const filter = {
      account: "bound",
      apis: ["OpenApp"],
      keyword: "养号",
      mode: "and",
      origin: "ai",
      remarks: [],
      tested: "no",
    } as const
    expect(matchBehavior(target, filter)).toBe(true)
    expect(matchBehavior(chain({ name: "晚间" }), filter)).toBe(false)
    expect(matchBehavior(chain({ name: "晚间" }), { ...filter, mode: "or" })).toBe(true)
    expect(matchBehavior(target, { ...filter, mode: "nand" })).toBe(false)
  })

  it("filters task chains by included behavior, skill and name", () => {
    const item = {
      name: "早班任务",
      stages: [
        { chainName: "登录", steps: [createStep("OpenApp", 1)] },
        { chainName: "养号", steps: [createStep("SendText", 2)] },
      ],
    }
    const filter = {
      apis: ["SendText"],
      chains: ["养号"],
      keyword: "早班",
      mode: "and",
      remarks: ["note"],
    } as const
    const noted = { ...item, remarks: [{ id: "note", name: "早班" }] }
    expect(matchTaskChain(noted, filter)).toBe(true)
    expect(matchTaskChain(item, filter)).toBe(false)
    expect(matchTaskChain(open("巡检"), filter)).toBe(false)
    expect(matchTaskChain(open("巡检"), { ...filter, mode: "nand" })).toBe(true)
  })
})

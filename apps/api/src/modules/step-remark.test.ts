import { describe, expect, test } from "bun:test"

import { nodeNameOf, readChainName, readRemark, stepLogTitle } from "./step-remark"

const title = (
  patch: Partial<Parameters<typeof stepLogTitle>[0]>,
): string =>
  stepLogTitle({
    chainName: "",
    dispatchItemId: null,
    nodeName: "点击节点",
    remark: "",
    skill: "ClickNode",
    taskChainId: null,
    taskChainName: "",
    taskName: "ClickNode",
    ...patch,
  })

describe("step remark", () => {
  test("reads a trimmed remark and rejects a long or broken one", () => {
    expect(readRemark(undefined)).toEqual({ ok: true, remark: "" })
    expect(readRemark("  点登录  ")).toEqual({ ok: true, remark: "点登录" })
    expect(readRemark("a\nb")).toEqual({ ok: false, error: "备注无效" })
    expect(readRemark(1)).toEqual({ ok: false, error: "备注无效" })
    expect(readRemark("x".repeat(41))).toEqual({ ok: false, error: "备注过长" })
  })

  test("reads a chain name", () => {
    expect(readChainName("  注册  ")).toEqual({ ok: true, name: "注册" })
    expect(readChainName(undefined)).toEqual({ ok: true, name: "" })
    expect(readChainName("名\n称")).toEqual({ ok: false, error: "行为链名无效" })
    expect(readChainName("名".repeat(81))).toEqual({ ok: false, error: "行为链名无效" })
  })

  test("joins the four log parts and skips a lab step", () => {
    expect(title({})).toBe("")
    expect(
      title({
        chainName: "注册",
        dispatchItemId: "item",
        remark: "点登录",
        taskName: "十月注册",
      }),
    ).toBe("十月注册-注册-点登录-点击节点")
    expect(
      title({
        chainName: "养号",
        nodeName: "节点整理",
        skill: "ArrangeNodes",
        taskChainId: "chain",
        taskChainName: "批量注册",
        taskName: "养号",
      }),
    ).toBe("批量注册-养号--节点整理")
    expect(title({ chainName: "注册", remark: "等验证码", nodeName: "获取验证码" })).toBe(
      "测试-注册-等验证码-获取验证码",
    )
    expect(title({ taskChainId: "chain", taskChainName: "", taskName: "阶段名", chainName: "养号" })).toBe(
      "阶段名-养号--点击节点",
    )
    expect(nodeNameOf("ClickNode", " 点击节点 ")).toBe("点击节点")
    expect(nodeNameOf("ClickNode", "")).toBe("ClickNode")
  })
})

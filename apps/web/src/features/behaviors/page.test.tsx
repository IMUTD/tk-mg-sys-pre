import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { cloudDevice, mockBehaviorApi } from "./behavior-api.test-fixtures"
import { getChains, resetChains } from "./chain-store"
import { BehaviorsPage } from "./page"
import { testOnDevice } from "./rpa-api"

beforeEach(() => {
  mockBehaviorApi()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const renderPage = (canWrite = true): void => {
  resetChains()
  render(
    <MemoryRouter>
      <AntdApp>
        <BehaviorsPage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

describe("BehaviorsPage", () => {
  it("lists saved chains and keeps the cloud tester on the right", async () => {
    renderPage()

    expect(await screen.findByText("早班养号")).toBeVisible()
    expect(screen.getByText("晚间巡检")).toBeVisible()
    expect(screen.getByText("行为链")).toBeVisible()
    expect(screen.getByText("任务链")).toBeVisible()
    expect(screen.getByText("AI制定")).toBeVisible()
    const behavior = screen.getByText("行为链")
    const taskChain = screen.getByText("任务链")
    const ai = screen.getByText("AI制定")
    expect(behavior.compareDocumentPosition(taskChain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(taskChain.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText("RPA编排")).toBeNull()
    expect(screen.getByRole("button", { name: "创建" })).toBeVisible()
    expect(screen.getByText("接口测试")).toBeVisible()
    expect(screen.getByLabelText("盒子")).toBeVisible()
    expect(screen.getByLabelText("坑位")).toBeVisible()
    expect((await screen.findAllByText(/264-亮17/)).length).toBeGreaterThan(0)
  })

  it("tests a chain on the selected cloud device", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("早班养号")

    const card = screen.getByText("早班养号").closest(".ant-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "测试" }))

    expect(await screen.findByText("云机测试 · 成功")).toBeVisible()
    expect(screen.getByRole("heading", { name: "OpenApp · 成功" })).toBeVisible()
    expect(screen.getByText("执行完成")).toBeVisible()
    expect(fetch).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deviceId: cloudDevice.deviceId,
          indexNum: 1,
          steps: [
            {
              afterMs: 0,
              guards: [],
              input: { pkg: "com.zhiliaoapp.musically" },
              scopes: { pkg: "internal" },
              skill: "OpenApp",
              sources: { pkg: "literal" },
            },
          ],
        }),
      }),
    )
  })

  it("lets AI draft a chain and save it after a successful test", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByText("AI制定"))
    await user.type(screen.getByLabelText("AI需求"), "打开抖音并点赞")
    await user.click(screen.getByRole("button", { name: "发送" }))
    expect(await screen.findByText(/已根据/)).toBeVisible()

    await user.click(screen.getByRole("button", { name: "测试" }))
    expect(await screen.findByText("测试成功，可以保存为行为链")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "保存为行为链" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("行为链名称"), "点赞草稿")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("已永久保存")).toBeVisible()
    expect(getChains().some((item) => item.name === "点赞草稿")).toBe(true)
  })

  it("edits a saved chain and writes the same chain back", async () => {
    const user = userEvent.setup()
    renderPage()
    const title = await screen.findByText("早班养号")
    const card = title.closest(".ant-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "编辑" }))

    expect(await screen.findByText("正在编辑「早班养号」")).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "保存" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("行为链名称")).toHaveValue("早班养号")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("已保存")).toBeVisible()
    const titles = document.querySelectorAll(".rpa-step .ant-card-head-title")
    expect(titles[0]?.textContent ?? "").toMatch(/^1\./)
    await user.click(screen.getByRole("button", { name: "添加步骤" }))
    const ordered = document.querySelectorAll(".rpa-step .ant-card-head-title")
    expect(ordered[0]?.textContent ?? "").toMatch(/^2\./)
    expect(ordered[1]?.textContent ?? "").toMatch(/^1\./)
    const top = ordered[0]?.closest(".rpa-step")
    const bottom = ordered[1]?.closest(".rpa-step")
    if (!(top instanceof HTMLElement) || !(bottom instanceof HTMLElement)) throw new Error("missing step")
    expect(within(top).getByRole("button", { name: "上移" })).toBeDisabled()
    expect(within(bottom).getByRole("button", { name: "下移" })).toBeDisabled()
    expect(document.querySelector(".rpa-studio")?.getAttribute("style") ?? "").toContain("height:")
    expect(fetch).toHaveBeenCalledWith(
      "/api/behavior-chains/chain-0",
      expect.objectContaining({ method: "PUT" }),
    )
    await user.click(screen.getByRole("button", { name: "返回" }))
    expect(await screen.findByText("早班养号")).toBeVisible()
    expect(screen.queryByText("正在编辑「早班养号」")).toBeNull()
  })

  it("saves a renamed chain as a new behavior chain", async () => {
    const user = userEvent.setup()
    renderPage()
    const title = await screen.findByText("早班养号")
    const card = title.closest(".ant-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "编辑" }))
    await user.click(await screen.findByRole("button", { name: "保存" }))
    const dialog = await screen.findByRole("dialog")
    const nameInput = within(dialog).getByLabelText("行为链名称")
    await user.clear(nameInput)
    await user.type(nameInput, "晚间巡检")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))
    expect(await screen.findByText("名称已存在")).toBeVisible()

    await user.clear(nameInput)
    await user.type(nameInput, "晚班养号")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))
    expect(await screen.findByText("已保存为新的行为链")).toBeVisible()
    expect(await screen.findByText("正在编辑「晚班养号」")).toBeVisible()
    expect(fetch).toHaveBeenCalledWith(
      "/api/behavior-chains",
      expect.objectContaining({
        body: expect.stringContaining('"name":"晚班养号"'),
        method: "POST",
      }),
    )
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/behavior-chains/chain-0",
      expect.objectContaining({ method: "PUT" }),
    )
    await user.click(screen.getByRole("button", { name: "返回" }))
    expect(await screen.findByText("晚班养号")).toBeVisible()
    expect(screen.getByText("早班养号")).toBeVisible()
  })

  it("maps the cloud screen with ArrangeNodes after each refresh", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("早班养号")
    await user.click(await screen.findByRole("button", { name: "云机映射" }))
    expect(await screen.findByText("已标出 1 个范围")).toBeVisible()
    expect(screen.getByRole("button", { name: "云机映射" })).toHaveTextContent("取消映射")
    expect(fetch).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deviceId: cloudDevice.deviceId,
          indexNum: 1,
          steps: [{ afterMs: 0, guards: [], input: {}, skill: "ArrangeNodes" }],
        }),
      }),
    )
  })

  it("creates a named chain on the list and rejects a duplicate name", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("早班养号")
    await user.click(screen.getByRole("button", { name: "创建" }))
    const dialog = await screen.findByRole("dialog", { name: "创建行为链" })
    await user.type(within(dialog).getByLabelText("行为链名称"), "新建链")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("已创建")).toBeVisible()
    expect(screen.getByText("新建链")).toBeVisible()
    expect(screen.queryByText("正在编辑「新建链」")).toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      "/api/behavior-chains",
      expect.objectContaining({
        body: JSON.stringify({ anchor: null, name: "新建链", origin: "rpa", steps: [] }),
        method: "POST",
      }),
    )

    await user.click(screen.getByRole("button", { name: "创建" }))
    const again = await screen.findByRole("dialog", { name: "创建行为链" })
    await user.type(within(again).getByLabelText("行为链名称"), "早班养号")
    await user.click(within(again).getByRole("button", { name: "确认" }))
    expect(await screen.findByText("名称已存在")).toBeVisible()
  })
}, 30_000)

describe("rpa-api", () => {
  it("rejects tests when the cloud device is offline", () => {
    const device = { ...cloudDevice, name: "270-亮18", online: false }
    expect(testOnDevice(device, "点击", "2026-09-17 18:00:00")).toMatchObject({ ok: false })
    expect(testOnDevice(null, "点击", "2026-09-17 18:00:00").message).toContain(
      "请先在右侧选择云机",
    )
  })
})

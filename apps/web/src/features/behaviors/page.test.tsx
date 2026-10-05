import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { getChains, resetChains } from "./chain-store"
import { BehaviorsPage } from "./page"
import { createSeedDevices, testOnDevice } from "./rpa-api"

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
    expect(screen.getByText("AI制定")).toBeVisible()
    expect(screen.getByText("RPA编排")).toBeVisible()
    expect(screen.getByText("接口测试")).toBeVisible()
    expect(screen.getByLabelText("测试云机")).toBeVisible()
    expect(screen.getAllByText(/264-亮17/).length).toBeGreaterThan(0)
  })

  it("tests a chain on the selected cloud device", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("早班养号")

    const card = screen.getByText("早班养号").closest(".ant-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "测试" }))

    expect(await screen.findByText("测试成功")).toBeVisible()
    expect(screen.getByText(/已在 264-亮17/)).toBeVisible()
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
}, 30_000)

describe("rpa-api", () => {
  it("rejects tests when the cloud device is offline", () => {
    const device = createSeedDevices().find((item) => item.name === "270-亮18")
    if (device === undefined) throw new Error("missing device")
    expect(testOnDevice(device, "点击", "2026-09-17 18:00:00")).toMatchObject({ ok: false })
    expect(testOnDevice(null, "点击", "2026-09-17 18:00:00").message).toContain(
      "请先在右侧选择云机",
    )
  })
})

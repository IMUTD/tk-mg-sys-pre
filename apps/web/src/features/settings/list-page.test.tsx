import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { ConfigListPage } from "./list-page"

const renderPage = (canWrite = true): void => {
  render(
    <MemoryRouter>
      <AntdApp>
        <ConfigListPage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

const rowByText = (text: string): HTMLElement => {
  const row = screen.getAllByRole("row").find((item) => item.textContent?.includes(text))
  if (row === undefined) throw new Error(`missing row ${text}`)
  return row
}

describe("ConfigListPage", () => {
  it("renders 云大师配置中心 filters, columns and seed configs", async () => {
    renderPage()

    expect(await screen.findByText("冰拓打码")).toBeVisible()
    expect(screen.getByLabelText("名称")).toBeVisible()
    expect(screen.getByLabelText("key")).toBeVisible()
    expect(screen.getByLabelText("用户名")).toBeVisible()
    expect(screen.getByLabelText("密码筛选")).toBeVisible()
    expect(screen.getByLabelText("备注")).toBeVisible()
    expect(screen.getByRole("button", { name: "搜索" })).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getByRole("button", { name: "修改" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "查看审计日志" })).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "额外参数" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "启用" })).toBeVisible()
    expect(screen.getByText("云端储存")).toBeVisible()
    expect(screen.getByText("喵提醒(喵码)")).toBeVisible()
    expect(screen.getAllByText("复制密码").length).toBeGreaterThan(0)
    expect(screen.getAllByText("无密码").length).toBeGreaterThan(0)
    expect(screen.queryByText("bingtop-secret")).not.toBeInTheDocument()
    expect(screen.queryByText("minio-secret")).not.toBeInTheDocument()
    expect(screen.queryByText("proxy-config-secret")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建配置" })).not.toBeInTheDocument()
    expect(screen.queryByText("系统参数")).not.toBeInTheDocument()
    expect(screen.queryByText("保存配置")).not.toBeInTheDocument()
  })

  it("hides write actions when canWrite is false", async () => {
    renderPage(false)
    await screen.findByText("冰拓打码")

    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
  })

  it("creates a config from 新增 and fills the default url", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("冰拓打码")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("新增配置")).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText("配置项"))
    await user.click(await screen.findByRole("option", { name: "冰拓打码" }))
    expect(within(dialog).getByLabelText("URL")).toHaveValue("https://www.bingtop.com/ocr/upload/")
    await user.type(within(dialog).getByLabelText("账号"), "new-ocr")
    await user.type(within(dialog).getByLabelText("密码"), "new-config-secret")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功")).toBeVisible()
    expect(screen.getByText("8")).toBeVisible()
    expect(screen.getByText("new-ocr")).toBeVisible()
    expect(screen.queryByText("new-config-secret")).not.toBeInTheDocument()
  })

  it("edits the selected config remark", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("打码平台")

    await user.click(screen.getByLabelText("选择 冰拓打码"))
    await user.click(screen.getByRole("button", { name: "修改" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("修改配置")).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText("备注"))
    await user.type(within(dialog).getByLabelText("备注"), "打码平台-改")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("打码平台-改")).toBeVisible()
    expect(screen.getByText("修改成功")).toBeVisible()
    expect(screen.queryByText("bingtop-secret")).not.toBeInTheDocument()
  })

  it("filters by key without rendering passwords", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("代理账号")

    await user.type(screen.getByLabelText("key"), "proxy")
    await user.click(screen.getByRole("button", { name: "搜索" }))

    expect(screen.getByText("代理账号")).toBeVisible()
    expect(screen.queryByText("冰拓打码")).not.toBeInTheDocument()
    expect(within(rowByText("代理账号")).getByText("复制密码")).toBeVisible()
    expect(screen.queryByText("proxy-config-secret")).not.toBeInTheDocument()
  })
}, 30_000)

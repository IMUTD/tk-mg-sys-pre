import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AntdApp } from "../../app/antd-app"
import { type ProxiesApi, proxyWriteInput } from "./api"
import { ProxiesListPage } from "./list-page"
import { emptyProxy } from "./myt-proxy"

const groupId = "11111111-1111-4111-8111-111111111111"

const section = (root: ParentNode, selector: string) => {
  const element = root.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing section: ${selector}`)
  expect(element).toBeVisible()
  return within(element)
}

const proxyRow = (remark: string) => {
  const row = screen.getByText(remark, { exact: true }).closest("tr")
  if (row === null) throw new Error(`Missing proxy row: ${remark}`)
  expect(row).toBeVisible()
  return within(row)
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname !== "/api/labels/catalog")
        throw new Error(`Unexpected request: ${url.pathname}`)
      return Response.json({
        administratorId: groupId,
        canDelete: true,
        scope: url.searchParams.get("scope"),
        groups: [],
        remarks: [],
      })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())
it("persists HTTP acceleration and displays server-supplied IP lookup details", async () => {
  const user = userEvent.setup()
  let proxy = {
    ...emptyProxy(1, "2026-10-07T00:00:00Z"),
    groupId,
    uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ip: "8.8.8.8",
    port: "8080",
    type: "1" as const,
    remark: "HTTP fixture",
  }
  const save = vi.fn(async (record) => {
    proxy = { ...proxy, ...record }
    return proxy
  })
  const detect = vi.fn(async () => {
    const result = {
      detection_type: "proxy_connectivity" as const,
      connectivity_checked: true,
      target_ip: proxy.ip,
      channel: "us" as const,
      mode: "detailed" as const,
      use_turbo: false,
      check_time: Date.now(),
      failures: 0,
      successes: 1,
      include_response: true,
      message: "ip_information_found",
      ok: true,
      status: 200,
      results: [
        {
          ok: true,
          delay: 30,
          status: 200,
          url: "https://api.ipapi.is/",
          response_body: {
            ip: proxy.ip,
            country: "AU",
            city: "Sydney",
            isp: "Cloudflare",
            asn: "AS13335",
          },
        },
        {
          ok: true,
          delay: 20,
          status: 204,
          url: "https://www.gstatic.com/generate_204",
        },
      ],
    }
    proxy = { ...proxy, result: JSON.stringify(result) }
    return result
  })
  const api: ProxiesApi = {
    list: async () => [proxy],
    credentials: async (record) => record,
    save,
    detect,
    delete: async () => undefined,
  }
  render(
    <AntdApp>
      <ProxiesListPage canWrite groupIds={[groupId]} api={api} />
    </AntdApp>,
  )
  await screen.findByText("HTTP fixture")
  await user.click(proxyRow("HTTP fixture").getByRole("button", { name: "编辑" }))
  const form = await screen.findByRole("dialog")
  await waitFor(() => expect(within(form).getByText("修改代理")).toBeVisible())
  expect(within(form).queryByText("节流")).not.toBeInTheDocument()
  expect(within(form).queryByText("加速列表")).not.toBeInTheDocument()
  expect(within(form).queryByText("加速节点")).not.toBeInTheDocument()
  expect(within(form).queryByText("地区检测")).not.toBeInTheDocument()
  expect(within(form).queryByLabelText("分组")).not.toBeInTheDocument()
  expect(within(form).queryByLabelText("有效期")).not.toBeInTheDocument()
  expect(within(form).queryByLabelText("刷新URL")).not.toBeInTheDocument()
  await user.click(section(form, ".dialog-footer").getByRole("button", { name: "确认" }))
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ type: "1", turbo: false }),
    expect.any(Array),
    true,
  )
  await waitFor(() => expect(form).not.toBeVisible())
  await user.click(proxyRow("HTTP fixture").getByRole("button", { name: "检测" }))
  const resultDialog = await screen.findByRole("dialog")
  await waitFor(() => expect(within(resultDialog).getByText("IP")).toBeVisible())
  expect(within(resultDialog).getByText("归属")).toBeVisible()
  expect(within(resultDialog).getByText("能否联网")).toBeVisible()
  expect(within(resultDialog).getByText("可以上网")).toBeVisible()
  expect(within(resultDialog).getByText("AU Sydney Cloudflare")).toBeVisible()
  const link = within(resultDialog).getByRole("link", { name: "https://ipinfo.io/8.8.8.8" })
  expect(link).toHaveAttribute("href", "https://ipinfo.io/8.8.8.8")
  expect(link).toHaveAttribute("target", "_blank")
  expect(screen.queryByRole("button", { name: "查看" })).not.toBeInTheDocument()
  expect(screen.queryByText("检测选项")).not.toBeInTheDocument()
  expect(detect).toHaveBeenCalledTimes(1)
})
it("looks up a newly created proxy immediately without repeating lookup on edits", async () => {
  const user = userEvent.setup()
  let records: ReturnType<typeof emptyProxy>[] = []
  const detect = vi.fn(async () => ({
    detection_type: "ip_lookup" as const,
    connectivity_checked: false,
    channel: "cn" as const,
    check_time: Date.now(),
    failures: 0,
    successes: 1,
    include_response: true,
    message: "ip_information_found",
    mode: "detailed" as const,
    ok: true,
    status: 200,
    results: [],
    use_turbo: false,
  }))
  const save = vi.fn(async (record) => {
    const saved = {
      ...record,
      id: 1,
      groupId,
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }
    records = [saved]
    return saved
  })
  const api: ProxiesApi = {
    list: async () => records,
    credentials: async (row) => row,
    save,
    detect,
    delete: async () => undefined,
  }
  render(
    <AntdApp>
      <ProxiesListPage canWrite groupIds={[groupId]} api={api} />
    </AntdApp>,
  )
  await user.click(
    await section(document, ".resource-crud-toolbar").findByRole("button", { name: "新增" }),
  )
  const form = await screen.findByRole("dialog")
  await waitFor(() => expect(within(form).getByText("新增代理")).toBeVisible())
  await user.click(within(form).getByText("HTTP", { exact: true }))
  await waitFor(() => expect(within(form).getByLabelText("HTTP", { exact: true })).toBeChecked())
  await user.click(within(form).getByLabelText("IP", { exact: true }))
  await user.paste("8.8.8.8")
  await user.click(within(form).getByLabelText("端口", { exact: true }))
  await user.paste("8080")
  await user.click(within(form).getByLabelText("备注", { exact: true }))
  await user.paste("Auto lookup")
  await user.click(section(form, ".dialog-footer").getByRole("button", { name: "确认" }))
  await waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
  expect(save).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ type: "1", ip: "8.8.8.8", port: "8080", remark: "Auto lookup" }),
    expect.any(Array),
    true,
  )
  expect(detect).toHaveBeenCalledWith(
    expect.objectContaining({ uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ip: "8.8.8.8" }),
    { channel: "cn", mode: "detailed", useTurbo: false },
  )
  expect(await screen.findByText("Auto lookup")).toBeVisible()
  await user.click(proxyRow("Auto lookup").getByRole("button", { name: "编辑" }))
  const editor = await waitFor(() => {
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("修改代理")).toBeVisible()
    return dialog
  })
  await user.click(section(editor, ".dialog-footer").getByRole("button", { name: "确认" }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(detect).toHaveBeenCalledTimes(1)
})
it("maps numeric accelerator selections to same-group UUIDs without sending blank secrets", () => {
  const landing = { ...emptyProxy(1, ""), groupId, ip: "1.1.1.1", port: "1080", turboNode: 2 }
  const node = { ...emptyProxy(2, ""), groupId, uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
  const input = proxyWriteInput(landing, [landing, node])
  expect(input).not.toHaveProperty("credentials")
  expect(input).toMatchObject({ configuration: { acceleratorId: node.uuid } })
  expect(() => proxyWriteInput(landing, [{ ...node, groupId: "other" }])).toThrow()
})
it("keeps refresh links in the credential payload, not public configuration patches", () => {
  const refreshUrl = "https://refresh.example.test/?token=private-refresh-token"
  const proxy = { ...emptyProxy(1, ""), groupId, ip: "1.1.1.1", port: "1080", refreshUrl }
  const input = proxyWriteInput(proxy, [proxy], true)
  expect(input).toMatchObject({ configuration: { refreshUrl: "" } })
  const credentials = input["credentials"]
  if (typeof credentials !== "string") throw new Error("Missing credential payload")
  expect(JSON.parse(credentials)).toMatchObject({ refreshUrl })
  expect(JSON.stringify(proxyWriteInput(proxy, [proxy]))).not.toContain("private-refresh-token")
})

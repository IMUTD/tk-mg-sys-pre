import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { PageKey } from "../../lib/pages"
import { labelScopeForPage, labelsChanged } from "./api"
import { BusinessLabelFilter, LabelFilterRow, UNASSIGNED_VALUE } from "./filter-row"

afterEach(() => vi.unstubAllGlobals())
const administratorId = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"

describe("classification rows", () => {
  it("supports single selection, keyboard, toggle off, all and closing without selection", () => {
    const change = vi.fn()
    const remove = vi.fn()
    const props = {
      title: "分组",
      options: [{ value: "one", label: "第一组", removable: true }],
      onChange: change,
      onRemove: remove,
    }
    const view = render(<LabelFilterRow {...props} selected={[]} />)
    fireEvent.keyDown(screen.getByRole("button", { name: /第一组/ }), { key: "Enter" })
    expect(change).toHaveBeenLastCalledWith(["one"])
    view.rerender(<LabelFilterRow {...props} selected={["one"]} />)
    fireEvent.click(screen.getByRole("button", { name: /第一组/ }))
    expect(change).toHaveBeenLastCalledWith([])
    change.mockClear()
    fireEvent.click(screen.getByLabelText(/^close$/i))
    expect(remove).toHaveBeenCalledWith("one")
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "全部" }))
    expect(change).toHaveBeenLastCalledWith([])
  })

  it("preserves multiple selection and does not clear required permission-group selection", () => {
    const change = vi.fn()
    const view = render(
      <LabelFilterRow
        title="包含标签"
        multiple
        selected={["a"]}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={change}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "B" }))
    expect(change).toHaveBeenLastCalledWith(["a", "b"])
    view.rerender(
      <LabelFilterRow
        title="权限分组"
        allowClear={false}
        selected={["a"]}
        options={[{ value: "a", label: "A" }]}
        onChange={change}
      />,
    )
    change.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "A" }))
    expect(change).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "全部" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /添加/ })).not.toBeInTheDocument()
  })

  it("shares the account scope across pages without merging proxy groups", async () => {
    let groups = [{ id, administratorId, name: "共享分组", scope: "account" }]
    const calls: { path: string; page: string | null; scope: string | null; method: string }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url)
        calls.push({
          path: url.pathname,
          page: url.searchParams.get("page"),
          scope: url.searchParams.get("scope"),
          method: request.method,
        })
        if (request.method === "POST") {
          const input = (await request.json()) as { name: string }
          const label = {
            id: "33333333-3333-4333-8333-333333333333",
            administratorId,
            name: input.name,
            scope: url.searchParams.get("scope") ?? "",
          }
          groups = [...groups, label]
          return Response.json(label, { status: 201 })
        }
        const scope = url.searchParams.get("scope")
        return Response.json({
          administratorId,
          canDelete: true,
          scope,
          groups: scope === "account" ? groups : [{ id, administratorId, name: "代理专用", scope }],
          remarks: [],
        })
      }),
    )
    const Harness = ({ page }: { page: string }) => {
      const [value, setValue] = useState("")
      return (
        <BusinessLabelFilter
          page={page}
          value={value}
          onChange={setValue}
          canWrite
          canDelete
          options={page === PageKey.Proxies ? [] : [{ label: "共享分组(2)", value: "共享分组" }]}
        />
      )
    }
    render(
      <AntdApp>
        <Harness page={PageKey.Accounts} />
        <Harness page={PageKey.AccountPool} />
        <Harness page={PageKey.Proxies} />
      </AntdApp>,
    )
    await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(3))
    const rows = screen.getAllByRole("group", { name: "分组" })
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "共享分组(2)" }),
    ).toBeVisible()
    expect(within(rows[0] as HTMLElement).queryByLabelText(/^close$/i)).not.toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByRole("button", { name: "代理专用" })).toBeVisible()
    expect(
      within(rows[2] as HTMLElement).queryByRole("button", { name: /共享分组/ }),
    ).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: "添加分组" })[0] as HTMLElement)
    await user.type(screen.getByRole("textbox", { name: "添加分组" }), "新分类{Enter}")
    await waitFor(() => expect(screen.getAllByRole("button", { name: /新分类/ })).toHaveLength(2))
    expect(calls.find((call) => call.method === "POST")?.page).toBe(PageKey.Accounts)
    expect(calls.find((call) => call.method === "POST")?.scope).toBe("account")
    expect(
      within(rows[2] as HTMLElement).queryByRole("button", { name: /新分类/ }),
    ).not.toBeInTheDocument()
    groups = [groups[0] as (typeof groups)[number]]
    labelsChanged()
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /新分类/ })).not.toBeInTheDocument(),
    )
  })

  it("does not offer shared deletion to non-administrators or creation in read-only views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          administratorId,
          canDelete: false,
          scope: "device",
          groups: [{ id, administratorId, name: "只读分类", scope: "device" }],
          remarks: [],
        }),
      ),
    )
    render(
      <AntdApp>
        <BusinessLabelFilter page={PageKey.Tasks} value="" onChange={vi.fn()} canDelete />
      </AntdApp>,
    )
    expect(await screen.findByRole("button", { name: "只读分类" })).toBeVisible()
    expect(screen.queryByLabelText(/^close$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "添加分组" })).not.toBeInTheDocument()
  })
  it("maps references to their object domain and rejects a mixed or mismatched catalog", async () => {
    expect(labelScopeForPage(PageKey.Tasks)).toBe("device")
    expect(labelScopeForPage(PageKey.AccountPool)).toBe("account")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          administratorId,
          canDelete: true,
          scope: "proxy",
          groups: [{ id, administratorId, name: "不应显示", scope: "proxy" }],
          remarks: [],
        }),
      ),
    )
    render(
      <AntdApp>
        <BusinessLabelFilter page={PageKey.Accounts} value="" onChange={vi.fn()} />
      </AntdApp>,
    )
    expect(await screen.findByText("分类加载失败")).toBeVisible()
    expect(screen.queryByRole("button", { name: "不应显示" })).not.toBeInTheDocument()
  })

  it("shows a close control on a chip that accounts already use", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          administratorId,
          canDelete: true,
          scope: "account",
          groups: [{ id, administratorId, name: "测试", scope: "account" }],
          remarks: [],
        }),
      ),
    )
    render(
      <AntdApp>
        <BusinessLabelFilter
          canDelete
          canWrite
          closable
          onChange={vi.fn()}
          options={[{ label: "测试(50)", value: "测试" }]}
          page={PageKey.Accounts}
          value=""
        />
      </AntdApp>,
    )
    expect(await screen.findByRole("button", { name: "测试(50)" })).toBeVisible()
    expect(screen.getByLabelText(/^close$/i)).toBeVisible()
  })

  it("puts an unassigned chip ahead of catalog chips and keeps it exclusive", () => {
    const change = vi.fn()
    render(
      <LabelFilterRow
        multiple
        onChange={change}
        options={[{ label: "测试", value: "测试" }]}
        selected={["测试"]}
        title="账号标签"
        unassigned={{ label: "未标签", value: UNASSIGNED_VALUE }}
      />,
    )
    const chips = screen.getAllByRole("button").map((item) => item.textContent)
    expect(chips.indexOf("未标签")).toBeLessThan(chips.indexOf("测试"))
    fireEvent.click(screen.getByRole("button", { name: "未标签" }))
    expect(change).toHaveBeenCalledWith([UNASSIGNED_VALUE])
  })
})

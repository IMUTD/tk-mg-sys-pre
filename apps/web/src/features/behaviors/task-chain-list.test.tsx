import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { loadChains, resetChains } from "./chain-store"
import { createStep } from "./rpa-api"
import { TaskChainList } from "./task-chain-list"

const chains = ["登录", "养号"].map((name, index) => ({
  anchor: null,
  id: `chain-${index}`,
  lastTestedAt: null,
  name,
  origin: "rpa" as const,
  steps: [createStep("OpenApp", index), createStep("OpenApp", index + 8)],
  updatedAt: "2026-09-17T10:00:00.000Z",
}))

const renderList = (): void => {
  render(
    <AntdApp>
      <TaskChainList canDelete canWrite />
    </AntdApp>,
  )
}

afterEach(() => {
  resetChains()
  vi.unstubAllGlobals()
})

describe("TaskChainList", () => {
  it("shows an empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/behavior-chains") return Response.json(chains)
        if (path === "/api/task-chains") return Response.json([])
        throw new Error(path)
      }),
    )
    await loadChains()
    renderList()
    expect(await screen.findByText("暂无任务链")).toBeVisible()
  })

  it("saves reordered stages with only chain ids and no loop count", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/behavior-chains") return Response.json(chains)
        if (path === "/api/task-chains" && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)))
          return Response.json({ id: "tc-1", name: "早班", stages: [] }, { status: 201 })
        }
        if (path === "/api/task-chains") return Response.json([])
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    await loadChains()
    renderList()
    await user.click(await screen.findByRole("button", { name: "新建任务链" }))
    await user.click(screen.getByLabelText("添加行为链"))
    await user.click(await screen.findByText("登录"))
    await user.click(screen.getByLabelText("添加行为链"))
    await user.click(await screen.findByText("养号"))
    expect(screen.getByText("1")).toBeVisible()
    expect(screen.getByText("2")).toBeVisible()
    expect(screen.getByText(/等/)).toBeVisible()
    expect(screen.queryByText(/循环次数/)).toBeNull()
    expect(screen.queryByText("随机范围")).toBeNull()
    const down = screen.getAllByRole("button", { name: "下移" })[0]
    if (down === undefined) throw new Error("missing move")
    await user.click(down)
    await user.type(screen.getByLabelText("任务链名称"), "早班")
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(bodies[0]).toEqual({
      name: "早班",
      stages: [{ chainId: "chain-1" }, { chainId: "chain-0" }],
    })
    expect(JSON.stringify(bodies[0])).not.toContain("repeat")
    expect(screen.queryByText(/循环次数/)).toBeNull()
  })

  it("asks for a name and at least one chain", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/behavior-chains") return Response.json(chains)
        if (path === "/api/task-chains") return Response.json([])
        throw new Error(path)
      }),
    )
    await loadChains()
    renderList()
    await user.click(await screen.findByRole("button", { name: "新建任务链" }))
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(await screen.findByText("请填写任务链名称")).toBeVisible()
    await user.type(screen.getByLabelText("任务链名称"), "早班")
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(await screen.findByText("请添加行为链")).toBeVisible()
  })

  it("shows the in-use message", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/behavior-chains") return Response.json(chains)
        if (init?.method === "DELETE") return Response.json({ error: "task_chain_in_use" }, { status: 409 })
        if (path === "/api/task-chains") {
          return Response.json([
            {
              id: "tc-1",
              name: "早班",
              stages: [{ chainId: "chain-0", chainName: "登录", position: 0, steps: [] }],
              updatedAt: "2026-09-17T10:00:00.000Z",
            },
          ])
        }
        throw new Error(path)
      }),
    )
    await loadChains()
    renderList()
    await user.click(await screen.findByRole("button", { name: "删除" }))
    await user.click(await screen.findByRole("button", { name: "确定" }))
    expect(await screen.findByText("这条任务链已被任务使用，不能删除")).toBeVisible()
  })
})

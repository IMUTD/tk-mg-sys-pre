import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { TaskRecordsPage } from "./records-page"

vi.mock(import("./catalog"), async (importOriginal) => ({
  ...(await importOriginal()),
  createSeedTaskLogs: () => [
    {
      content: "发布作品完成",
      createdAt: "2026-09-17 12:00:00",
      feature: "发布作品",
      id: 1,
      updatedAt: "2026-09-17 12:01:00",
    },
    {
      content: "检查任务已创建并自动启动",
      createdAt: "2026-09-17 13:00:00",
      feature: "账号检查",
      id: 2,
      updatedAt: "2026-09-17 13:00:00",
    },
  ],
}))

const wrap = (page: ReactElement): void => {
  render(
    <MemoryRouter>
      <AntdApp>{page}</AntdApp>
    </MemoryRouter>,
  )
}

describe("jobs pages", () => {
  it("lists task records and can search by feature", async () => {
    const user = userEvent.setup()
    wrap(<TaskRecordsPage />)
    expect(screen.getByText("发布作品完成")).toBeVisible()
    await user.type(screen.getByLabelText("功能"), "账号检查")
    expect(screen.getByText("检查任务已创建并自动启动")).toBeVisible()
    expect(screen.queryByText("发布作品完成")).not.toBeInTheDocument()
  })

  it("shows an automatic replay count and no manual replay button", async () => {
    const user = userEvent.setup()
    const step = {
      attempt: 1,
      linked: true,
      parameters: {},
      repeatCount: 1,
      repeatIndex: 0,
      status: "succeeded",
      taskStatus: "succeeded",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/dispatch-records") && (init?.method ?? "GET") === "GET") {
          return Response.json({
            boxes: [
              {
                id: "box-1",
                name: "140",
                tasks: [
                  {
                    account: "user-a",
                    id: "item-1",
                    name: "早班",
                    started: true,
                    status: "started",
                    steps: [
                      {
                        ...step,
                        sequence: 0,
                        skill: "OpenApp",
                        stageName: "登录",
                        stagePosition: 0,
                        taskId: "task-ok",
                      },
                      {
                        ...step,
                        sequence: 1,
                        skill: "SetProxy",
                        autoRetryLimit: 3,
                        autoUsed: 1,
                        stageName: "代理",
                        stagePosition: 1,
                        status: "failed",
                        taskId: "task-bad",
                        taskStatus: "failed",
                      },
                    ],
                  },
                ],
              },
            ],
          })
        }
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    wrap(<TaskRecordsPage canWrite groupId="group-1" />)
    const expand = async () => {
      const buttons = await screen.findAllByRole("button", { name: "展开行" })
      const closed = buttons.find((button) => button.getAttribute("aria-expanded") !== "true")
      if (closed !== undefined) await user.click(closed)
    }
    await expand()
    await expand()
    expect(screen.getByText("已自动重跑 1/3 次")).toBeVisible()
    expect(screen.queryByRole("button", { name: "插队重跑" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重跑中" })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

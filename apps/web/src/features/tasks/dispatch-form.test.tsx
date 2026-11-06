import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { DispatchForm } from "./dispatch-form"

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const textId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const options = {
  accountGroups: ["一组"],
  accountTags: [],
  accounts: [{ group: "一组", id: accountId, identifier: "user-a", tags: [] }],
  boxGroups: ["盒子组"],
  boxRemarks: [],
  chains: [],
  devices: [{ host: "192.168.76.140", id: "box-140", name: "140" }],
  pits: [1, 2, 3, 4, 5],
  pools: [],
  proxies: [],
  proxyGroups: ["代理组"],
  proxyRemarks: [],
  languages: [],
  proxyTags: [],
  regions: [],
  taskChains: [
    {
      id: "tc-1",
      name: "早班",
      stages: [
        {
          anchor: { key: "identifier", table: "operation_account" },
          chainId: "chain-0",
          chainName: "登录",
          position: 0,
          steps: [
            { api: "OpenApp", scopes: {}, sources: {} },
            {
              api: "SendText",
              remark: "登录文案",
              scopes: { text: "external" },
              sources: { text: "pool.text" },
            },
            {
              api: "SendText",
              remark: "内部文案",
              scopes: { text: "internal" },
              sources: { text: "literal" },
            },
          ],
        },
        {
          anchor: null,
          chainId: "chain-1",
          chainName: "养号",
          position: 1,
          steps: [{ api: "OpenApp", scopes: {}, sources: {} }],
        },
      ],
    },
  ],
  textTags: ["评论"],
  texts: [{ category: "评论", content: "hello", id: textId, remark: "", tags: [] }],
}

const pickedAccount = {
  groups: ["一组"],
  ids: [accountId],
  keyword: "",
  mode: "and",
  tags: [],
  ungrouped: false,
}

const pickedText = {
  ids: [textId],
  keyword: "",
  mode: "and",
  sequence: 1,
  stage: 0,
  tags: ["评论"],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DispatchForm", () => {
  it("asks for a task chain and keeps one field per step when a stage repeats", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/dispatches/options")) return Response.json(options)
        if (path === "/api/devices") {
          return Response.json([
            {
              boxGroupId: null,
              boxGroupName: null,
              externalId: "140",
              firmware: "",
              host: "192.168.76.140",
              id: "11111111-1111-4111-8111-111111111111",
              name: "140",
              remarks: [],
              sequenceNo: 1,
              status: "online",
              version: "",
            },
          ])
        }
        if (path === "/api/box-labels") return Response.json({ groups: [], remarks: [] })
        if (path.includes("/slots")) {
          return Response.json([
            {
              height: "1280",
              host: "192.168.76.140",
              index: 1,
              label: "hmg-now",
              status: "online",
              width: "720",
            },
          ])
        }
        if (path.endsWith("/dispatches") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)))
          return Response.json({ id: "d-1", status: "ready" }, { status: 201 })
        }
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    render(
      <AntdApp>
        <DispatchForm groupId="group-1" onCancel={() => undefined} onCreated={() => undefined} />
      </AntdApp>,
    )
    expect(await screen.findByText("请选择任务链")).toBeVisible()
    await user.click(screen.getByLabelText("选择任务"))
    await user.click(await screen.findByText("早班"))
    expect(screen.getByLabelText("登录第1段固定次数")).toHaveValue("1")
    expect(screen.getByLabelText("养号第2段固定次数")).toHaveValue("1")
    expect(screen.getByText("登录文案")).toBeVisible()
    expect(screen.queryByText("内部文案")).toBeNull()
    expect(screen.queryByText("登录 · 第 2 步输入文字")).toBeNull()
    expect(screen.getByText("选择账号")).toBeVisible()
    expect(screen.queryByLabelText("盒子范围")).toBeNull()
    expect(screen.getByText("坑位范围")).toBeVisible()
    expect(screen.getByText("选择坑位")).toBeVisible()
    expect(await screen.findByRole("checkbox", { name: "坑位 1" })).toBeVisible()
    expect(screen.queryByText("hmg-now")).toBeNull()
    expect(screen.getByText("选择代理")).toBeVisible()
    expect(screen.getByText("选择任务").closest(".ant-form-item")).toHaveClass("dispatch-choice")
    expect(screen.queryByText("选择地区")).toBeNull()
    expect(screen.queryByText("选择语言")).toBeNull()
    await user.clear(screen.getByLabelText("养号第2段固定次数"))
    await user.type(screen.getByLabelText("养号第2段固定次数"), "5")
    expect(screen.getAllByText("登录文案")).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "一组(1)" }))
    await user.clear(screen.getByLabelText("养号第2段固定次数"))
    await user.type(screen.getByLabelText("养号第2段固定次数"), "0")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(await screen.findByText("循环次数为 1 到 99")).toBeVisible()
    expect(bodies).toHaveLength(0)
    await user.clear(screen.getByLabelText("养号第2段固定次数"))
    await user.type(screen.getByLabelText("养号第2段固定次数"), "100")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies).toHaveLength(0)
    await user.clear(screen.getByLabelText("养号第2段固定次数"))
    await user.type(screen.getByLabelText("养号第2段固定次数"), "5")
    await user.click(await screen.findByRole("checkbox", { name: "坑位 1" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(await screen.findByText("请选择文本池")).toBeVisible()
    expect(bodies).toHaveLength(0)
    await user.click(screen.getByRole("button", { name: "评论(1)" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies[0]).toEqual({
      accounts: pickedAccount,
      instances: [{ deviceId: "11111111-1111-4111-8111-111111111111", index: 1 }],
      media: [],
      pitRange: [1, 2, 3, 4, 5],
      repeats: [{ count: 5, mode: "fixed", stage: 1 }],
      taskChainId: "tc-1",
      texts: [pickedText],
    })
    expect(bodies[0]).not.toHaveProperty("chainId")
    const warm = screen.getByRole("radiogroup", { name: "养号第2段循环方式" })
    await user.click(within(warm).getByRole("radio", { name: "随机范围" }))
    await user.clear(screen.getByLabelText("养号第2段最少次数"))
    await user.type(screen.getByLabelText("养号第2段最少次数"), "5")
    await user.clear(screen.getByLabelText("养号第2段最多次数"))
    await user.type(screen.getByLabelText("养号第2段最多次数"), "2")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(await screen.findByText("随机范围为 1 到 99，且最少不能大于最多")).toBeVisible()
    expect(bodies).toHaveLength(1)
    await user.clear(screen.getByLabelText("养号第2段最少次数"))
    await user.type(screen.getByLabelText("养号第2段最少次数"), "2")
    await user.clear(screen.getByLabelText("养号第2段最多次数"))
    await user.type(screen.getByLabelText("养号第2段最多次数"), "5")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies[1]).toEqual({
      accounts: pickedAccount,
      instances: [{ deviceId: "11111111-1111-4111-8111-111111111111", index: 1 }],
      media: [],
      pitRange: [1, 2, 3, 4, 5],
      repeats: [{ max: 5, min: 2, mode: "range", stage: 1 }],
      taskChainId: "tc-1",
      texts: [pickedText],
    })
    expect(bodies[1]).not.toHaveProperty("chainId")
    expect(screen.getAllByText("登录文案")).toHaveLength(1)
  })

  it("asks for a hot region only when the chain sets a country", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    const regionOptions = {
      ...options,
      regions: [
        {
          countries: [
            { code: "US", name: "美国" },
            { code: "BR", name: "巴西" },
          ],
          name: "美洲",
        },
        { countries: [{ code: "ID", name: "印度尼西亚" }], name: "亚洲" },
        { countries: [{ code: "GB", name: "英国" }], name: "欧洲" },
        { countries: [{ code: "EG", name: "埃及" }], name: "非洲" },
        { countries: [{ code: "AU", name: "澳大利亚" }], name: "大洋洲" },
      ],
      taskChains: [
        ...options.taskChains,
        {
          id: "tc-region",
          name: "设地区",
          stages: [
            {
              anchor: null,
              chainId: "chain-r",
              chainName: "语言",
              position: 0,
              steps: [
                {
                  api: "CreateAndroid",
                  scopes: { countryCode: "internal" },
                  sources: { countryCode: "literal" },
                },
              ],
            },
          ],
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/dispatches/options")) return Response.json(regionOptions)
        if (path === "/api/devices") {
          return Response.json([
            {
              boxGroupId: null,
              boxGroupName: null,
              externalId: "140",
              firmware: "",
              host: "192.168.76.140",
              id: "11111111-1111-4111-8111-111111111111",
              name: "140",
              remarks: [],
              sequenceNo: 1,
              status: "online",
              version: "",
            },
          ])
        }
        if (path === "/api/box-labels") return Response.json({ groups: [], remarks: [] })
        if (path.includes("/slots")) {
          return Response.json([
            {
              height: "1280",
              host: "192.168.76.140",
              index: 1,
              label: "",
              status: "online",
              width: "720",
            },
          ])
        }
        if (path.endsWith("/dispatches") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)))
          return Response.json({ id: "d-2", status: "ready" }, { status: 201 })
        }
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    render(
      <AntdApp>
        <DispatchForm groupId="group-1" onCancel={() => undefined} onCreated={() => undefined} />
      </AntdApp>,
    )
    await user.click(await screen.findByLabelText("选择任务"))
    await user.click(await screen.findByText("设地区"))
    expect(screen.getByText("选择地区")).toBeVisible()
    expect(screen.queryByText("选择语言")).toBeNull()
    expect(screen.getByRole("button", { name: "美洲" })).toHaveClass("ant-btn-primary")
    expect(screen.getByRole("button", { name: "美国" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "印度尼西亚" })).toBeNull()
    await user.click(await screen.findByRole("checkbox", { name: "坑位 1" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(await screen.findByText("请选择地区")).toBeVisible()
    expect(bodies).toHaveLength(0)
    await user.click(screen.getByRole("button", { name: "美国" }))
    await user.click(screen.getByRole("button", { name: "亚洲" }))
    expect(screen.queryByRole("button", { name: "美国" })).toBeNull()
    expect(screen.getByRole("button", { name: "印度尼西亚" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "美洲" }))
    expect(screen.getByRole("button", { name: "美国" })).toHaveClass("ant-btn-primary")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies[0]).toEqual({
      instances: [{ deviceId: "11111111-1111-4111-8111-111111111111", index: 1 }],
      media: [],
      pitRange: [1, 2, 3, 4, 5],
      region: "US",
      repeats: [],
      taskChainId: "tc-region",
      texts: [],
    })
    expect(bodies[0]).not.toHaveProperty("language")
  })

  it("asks for a language only when the chain sets one", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    const languageOptions = {
      ...options,
      languages: [
        { code: "en", name: "英语" },
        { code: "in", name: "印尼语" },
      ],
      regions: [
        {
          countries: [{ code: "US", name: "美国" }],
          name: "美洲" as const,
        },
      ],
      taskChains: [
        ...options.taskChains,
        {
          id: "tc-language",
          name: "设语言",
          stages: [
            {
              anchor: null,
              chainId: "chain-l",
              chainName: "语言",
              position: 0,
              steps: [
                {
                  api: "SetLanguageCountry",
                  scopes: { country: "internal", language: "internal" },
                  sources: { country: "literal", language: "literal" },
                },
              ],
            },
          ],
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/dispatches/options")) return Response.json(languageOptions)
        if (path === "/api/devices") {
          return Response.json([
            {
              boxGroupId: null,
              boxGroupName: null,
              externalId: "140",
              firmware: "",
              host: "192.168.76.140",
              id: "11111111-1111-4111-8111-111111111111",
              name: "140",
              remarks: [],
              sequenceNo: 1,
              status: "online",
              version: "",
            },
          ])
        }
        if (path === "/api/box-labels") return Response.json({ groups: [], remarks: [] })
        if (path.includes("/slots")) {
          return Response.json([
            {
              height: "1280",
              host: "192.168.76.140",
              index: 1,
              label: "",
              status: "online",
              width: "720",
            },
          ])
        }
        if (path.endsWith("/dispatches") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)))
          return Response.json({ id: "d-3", status: "ready" }, { status: 201 })
        }
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    render(
      <AntdApp>
        <DispatchForm groupId="group-1" onCancel={() => undefined} onCreated={() => undefined} />
      </AntdApp>,
    )
    await user.click(await screen.findByLabelText("选择任务"))
    await user.click(await screen.findByText("设语言"))
    expect(screen.getByText("选择语言")).toBeVisible()
    expect(screen.getByRole("button", { name: "英语" })).toBeVisible()
    await user.click(await screen.findByRole("checkbox", { name: "坑位 1" }))
    await user.click(screen.getByRole("button", { name: "美国" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(await screen.findByText("请选择语言")).toBeVisible()
    expect(bodies).toHaveLength(0)
    await user.click(screen.getByRole("button", { name: "英语" }))
    await user.click(screen.getByRole("button", { name: "英语" }))
    expect(screen.getByRole("button", { name: "英语" })).toHaveClass("ant-btn-primary")
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies[0]).toEqual({
      instances: [{ deviceId: "11111111-1111-4111-8111-111111111111", index: 1 }],
      language: "en",
      media: [],
      pitRange: [1, 2, 3, 4, 5],
      region: "US",
      repeats: [],
      taskChainId: "tc-language",
      texts: [],
    })
  })

  it("shows one slider per external click chance and submits that percent", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/dispatches/options")) {
          return Response.json({
            ...options,
            taskChains: [
              {
                id: "tc-chance",
                name: "点赞任务",
                stages: [
                  {
                    anchor: null,
                    chainId: "chain-chance",
                    chainName: "点赞",
                    position: 0,
                    steps: [
                      {
                        api: "ClickJumpNodes",
                        params: { clickChance: "" },
                        remark: "点赞",
                        scopes: { clickChance: "external" },
                        sources: { clickChance: "chance.external" },
                      },
                      {
                        api: "ClickJumpNodes",
                        params: { clickChance: "100" },
                        remark: "内部",
                        scopes: { clickChance: "internal" },
                        sources: { clickChance: "literal" },
                      },
                      {
                        api: "ClickJumpNodes",
                        params: { clickChance: "" },
                        remark: "",
                        scopes: { clickChance: "external" },
                        sources: { clickChance: "chance.external" },
                      },
                    ],
                  },
                ],
              },
            ],
          })
        }
        if (path === "/api/devices") {
          return Response.json([
            {
              boxGroupId: null,
              boxGroupName: null,
              externalId: "140",
              firmware: "",
              host: "192.168.76.140",
              id: "11111111-1111-4111-8111-111111111111",
              name: "140",
              remarks: [],
              sequenceNo: 1,
              status: "online",
              version: "",
            },
          ])
        }
        if (path === "/api/box-labels") return Response.json({ groups: [], remarks: [] })
        if (path.includes("/slots")) {
          return Response.json([
            {
              height: "1280",
              host: "192.168.76.140",
              index: 1,
              label: "hmg-now",
              status: "online",
              width: "720",
            },
          ])
        }
        if (path.endsWith("/dispatches") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)))
          return Response.json({ id: "d-chance", status: "ready" }, { status: 201 })
        }
        throw new Error(`${init?.method ?? "GET"} ${path}`)
      }),
    )
    render(
      <AntdApp>
        <DispatchForm groupId="group-1" onCancel={() => undefined} onCreated={() => undefined} />
      </AntdApp>,
    )
    await user.click(await screen.findByLabelText("选择任务"))
    await user.click(await screen.findByText("点赞任务"))
    expect(screen.getByText("点赞")).toBeVisible()
    expect(screen.getAllByText("点击概率").length).toBeGreaterThan(0)
    expect(screen.queryByText("内部")).toBeNull()
    expect(screen.queryByText("点赞 · 第 1 步")).toBeNull()
    expect(screen.getAllByText("100%")).toHaveLength(2)
    const like = screen.getByRole("slider", { name: "点赞第 1 步点击概率" })
    like.focus()
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByText("99%")).toBeVisible()
    await user.click(await screen.findByRole("checkbox", { name: "坑位 1" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(bodies[0]).toMatchObject({
      chances: [
        { sequence: 0, stage: 0, value: 99 },
        { sequence: 2, stage: 0, value: 100 },
      ],
      taskChainId: "tc-chance",
    })
  })
})

import { HTTPError } from "ky"
import { afterEach, describe, expect, it, vi } from "vitest"
import { poolTestDetails, poolTestFilter, poolTestGroup } from "../../test/account-pool-fixtures"
import { createAccountPoolsApi, poolRequestError } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("account-pool API", () => {
  it("uses group-scoped endpoints, credentials and decoded dates for saved pools", async () => {
    const details = poolTestDetails()
    let payload: unknown
    const fetch = vi.fn(async (request: Request) => {
      payload = await request.clone().json()
      return Response.json(details, { status: 201 })
    })
    vi.stubGlobal("fetch", fetch)
    const api = createAccountPoolsApi()
    const saved = await api.create(poolTestGroup, {
      key: "接口测试",
      mode: "all",
      filter: poolTestFilter(),
      remark: "",
      times: 2,
    })
    const request = fetch.mock.calls[0]?.[0] as Request | undefined
    expect(request?.url).toContain(`/api/groups/${poolTestGroup}/operations/account-pools`)
    expect(request?.method).toBe("POST")
    expect(request?.credentials).toBe("include")
    expect(payload).toMatchObject({ mode: "all", times: 2, key: "接口测试" })
    expect(saved.expiresAt).toBeInstanceOf(Date)
  })

  it("requests server pagination and filtered candidates", async () => {
    let payload: unknown
    const fetch = vi.fn(async (request: Request) => {
      if (request.method === "GET")
        return Response.json({ items: [], total: 25, page: 2, pageSize: 10 })
      payload = await request.clone().json()
      return Response.json({ items: [], total: 0, groups: [] })
    })
    vi.stubGlobal("fetch", fetch)
    const api = createAccountPoolsApi()
    expect(
      (await api.list(poolTestGroup, { id: "", key: "验收", remark: "", page: 2, pageSize: 10 }))
        .total,
    ).toBe(25)
    await api.sources(poolTestGroup, poolTestFilter(), 3, 50)
    expect(new URL(fetch.mock.calls[0]?.[0].url ?? "").searchParams.get("page")).toBe("2")
    expect(payload).toMatchObject({ page: 3, pageSize: 50 })
  })

  it("rejects malformed success payloads instead of treating them as saved data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "not-a-uuid" })),
    )
    await expect(
      createAccountPoolsApi().details(poolTestGroup, poolTestDetails().id),
    ).rejects.toThrow()
  })

  it("maps conflicts and permissions without retrying a failed write", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: "account_pool_key_conflict" }, { status: 409 }),
    )
    vi.stubGlobal("fetch", fetch)
    let failure: unknown
    try {
      await createAccountPoolsApi().create(poolTestGroup, {
        key: "冲突",
        filter: poolTestFilter(),
        mode: "all",
        remark: "",
        times: 1,
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(HTTPError)
    expect(await poolRequestError(failure)).toBe("账号池编码已存在")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

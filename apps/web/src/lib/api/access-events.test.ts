import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiAccessEvent,
  advanceApiSession,
  apiSessionGeneration,
  observeApiAccess,
} from "./access-events"

describe("API session recovery", () => {
  it("ignores a response started before a new login", async () => {
    const listener = vi.fn()
    window.addEventListener("tk-mg:api-access", listener)
    const generation = apiSessionGeneration()
    advanceApiSession()
    await observeApiAccess(
      new Request(`${window.location.origin}/api/tasks`),
      new Response("", { status: 401 }),
      generation,
    )
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener("tk-mg:api-access", listener)
  })
  afterEach(() => vi.restoreAllMocks())
  it("announces an expired business session", async () => {
    const listener = vi.fn()
    window.addEventListener("tk-mg:api-access", listener, { once: true })
    await observeApiAccess(
      new Request(`${window.location.origin}/api/tasks`),
      new Response("", { status: 401 }),
    )
    expect(listener).toHaveBeenCalledWith(expect.any(ApiAccessEvent))
  })
  it("announces identity denial without consuming the response body", async () => {
    const listener = vi.fn()
    window.addEventListener("tk-mg:api-access", listener, { once: true })
    const response = Response.json({ error: "identity_verification_required" }, { status: 403 })
    await observeApiAccess(
      new Request(`${window.location.origin}/api/box-service/orders`),
      response,
    )
    expect(listener).toHaveBeenCalledOnce()
    expect(await response.json()).toEqual({ error: "identity_verification_required" })
  })
  it("ignores normal permission denials, login failures and other origins", async () => {
    const listener = vi.fn()
    window.addEventListener("tk-mg:api-access", listener)
    await observeApiAccess(
      new Request(`${window.location.origin}/api/tasks`),
      Response.json({ error: "forbidden" }, { status: 403 }),
    )
    await observeApiAccess(
      new Request(`${window.location.origin}/api/auth/login`),
      new Response("", { status: 401 }),
    )
    await observeApiAccess(
      new Request("https://other.example/api/tasks"),
      new Response("", { status: 401 }),
    )
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener("tk-mg:api-access", listener)
  })
})

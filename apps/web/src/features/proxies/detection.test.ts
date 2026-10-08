import { expect, it, vi } from "vitest"
import { defaultIpLookupOptions, detectProxyBatch } from "./detection"
import { emptyProxy, type ProxyCheckResult } from "./myt-proxy"

const result: ProxyCheckResult = {
  detection_type: "ip_lookup",
  connectivity_checked: false,
  channel: "cn",
  check_time: 1,
  failures: 0,
  successes: 1,
  include_response: true,
  message: "ip_information_found",
  mode: "detailed",
  ok: true,
  results: [],
  status: 200,
  use_turbo: false,
}
it("queries every row with bounded two-row batches and no accelerator use", async () => {
  let active = 0
  let peak = 0
  const order: number[] = []
  const detect = vi.fn(async (row, options) => {
    expect(options.useTurbo).toBe(false)
    active++
    peak = Math.max(peak, active)
    order.push(row.id)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return result
  })
  const pause = vi.fn(async () => undefined)
  const onResult = vi.fn()
  const rows = Array.from({ length: 5 }, (_, index) => emptyProxy(index + 1, ""))
  expect(
    await detectProxyBatch(
      { detect },
      rows,
      { ...defaultIpLookupOptions, useTurbo: true },
      onResult,
      pause,
    ),
  ).toEqual({ succeeded: 5, failed: 0, requestFailures: 0 })
  expect(peak).toBe(2)
  expect(order).toEqual([1, 2, 3, 4, 5])
  expect(pause).toHaveBeenCalledTimes(2)
  expect(onResult).toHaveBeenCalledTimes(5)
})
it("continues after request and lookup failures without inventing stored results", async () => {
  const detect = vi.fn(async (row) => {
    if (row.id === 1) throw new Error("request denied")
    return row.id === 2 ? { ...result, ok: false, message: "ip_provider_rate_limited" } : result
  })
  const onResult = vi.fn()
  const rows = [1, 2, 3].map((id) => emptyProxy(id, ""))
  expect(
    await detectProxyBatch(
      { detect },
      rows,
      defaultIpLookupOptions,
      onResult,
      async () => undefined,
    ),
  ).toEqual({ succeeded: 1, failed: 2, requestFailures: 1 })
  expect(onResult.mock.calls.map(([row]) => row.id)).toEqual([2, 3])
})

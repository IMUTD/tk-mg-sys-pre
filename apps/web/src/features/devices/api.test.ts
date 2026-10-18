import { afterEach, describe, expect, it, vi } from "vitest"

import { createDevicesApi } from "./api"
import { deviceId, groupId, instanceId, makeCommand } from "./device.test-fixtures"

afterEach(() => vi.unstubAllGlobals())

const devicePath = `/api/groups/${groupId}/devices/${deviceId}`

const mockTransport = (respond: (request: Request) => Response) => {
  const requests: Request[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return respond(request)
    }),
  )
  return requests
}

describe("device command API contract", () => {
  it("deletes the device through its group-scoped endpoint", async () => {
    const requests = mockTransport(() => new Response(null, { status: 204 }))

    await createDevicesApi().delete({ deviceId, groupId })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe("DELETE")
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(devicePath)
  })

  it("submits a health check and parses the acknowledged result", async () => {
    const command = makeCommand("succeeded", { kind: "acknowledged" })
    const requests = mockTransport(() => Response.json(command))

    const result = await createDevicesApi().submitCommand({
      deviceId,
      groupId,
      idempotencyKey: "health-key",
      type: "health_check",
    })

    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(`${devicePath}/commands`)
    expect(requests[0]?.method).toBe("POST")
    expect(await requests[0]?.json()).toEqual({
      idempotencyKey: "health-key",
      type: "health_check",
    })
    expect(result).toMatchObject({ result: { kind: "acknowledged" }, status: "succeeded" })
  })

  it("submits and cancels a running capture for the selected instance", async () => {
    const command = { ...makeCommand("running"), instanceId, kind: "capture_screen" }
    const requests = mockTransport((request) =>
      Response.json(
        request.url.endsWith("/cancel") ? { ...command, status: "cancelled" } : command,
      ),
    )
    const api = createDevicesApi()

    const submitted = await api.submitCommand({
      deviceId,
      groupId,
      idempotencyKey: "capture-key",
      instanceId,
      type: "capture_screen",
    })
    const cancelled = await api.cancelCommand({ commandId: submitted.id, deviceId, groupId })

    expect(requests).toHaveLength(2)
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(`${devicePath}/commands`)
    expect(requests[0]?.method).toBe("POST")
    expect(await requests[0]?.json()).toEqual({
      idempotencyKey: "capture-key",
      instanceId,
      type: "capture_screen",
    })
    expect(new URL(requests[1]?.url ?? "").pathname).toBe(
      `${devicePath}/commands/${command.id}/cancel`,
    )
    expect(requests[1]?.method).toBe("POST")
    expect(cancelled).toMatchObject({ instanceId, kind: "capture_screen", status: "cancelled" })
  })
})

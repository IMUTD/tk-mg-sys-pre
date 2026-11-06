import { vi } from "vitest"
import { z } from "zod"

import { type CloudDevice, createStep, RPA_API_OPTIONS } from "./rpa-api"

export const cloudDevice: CloudDevice = {
  deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  height: 1280,
  id: 1,
  indexNum: 1,
  ip: "192.168.76.131",
  name: "264-亮17",
  online: true,
  rpaPort: 30004,
  slot: 1,
  width: 720,
}

const ChainStepSchema = z.object({
  api: z.string(),
  delayMs: z.number(),
  guards: z.array(z.string()),
  params: z.record(z.string(), z.string()),
  remark: z.string().optional(),
  scopes: z.record(z.string(), z.string()),
  sources: z.record(z.string(), z.string()),
})

const SaveChainSchema = z.object({
  anchor: z.null(),
  name: z.string(),
  origin: z.enum(["ai", "rpa"]),
  steps: z.array(ChainStepSchema),
})

const UpdateChainSchema = z.object({
  anchor: z.null(),
  name: z.string(),
  steps: z.array(ChainStepSchema),
})

export const mockBehaviorApi = () => {
  const timestamp = "2026-09-17T10:00:00.000Z"
  const chains = ["早班养号", "晚间巡检"].map((name, index) => ({
    anchor: null,
    id: `chain-${index}`,
    lastTestedAt: null,
    name,
    origin: "rpa",
    steps: [createStep("OpenApp", 0)],
    updatedAt: timestamp,
  }))
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      .pathname
    if (path === "/api/behavior-chains" && init?.method === "POST") {
      const payload = SaveChainSchema.parse(JSON.parse(String(init.body)))
      return Response.json({
        ...payload,
        id: "saved-chain",
        lastTestedAt: timestamp,
        updatedAt: timestamp,
      })
    }
    if (init?.method === "PUT" && path.startsWith("/api/behavior-chains/")) {
      const payload = UpdateChainSchema.parse(JSON.parse(String(init.body)))
      const id = path.slice("/api/behavior-chains/".length)
      const current = chains.find((item) => item.id === id)
      return Response.json({
        anchor: payload.anchor,
        id,
        lastTestedAt: current?.lastTestedAt ?? null,
        name: payload.name,
        origin: current?.origin ?? "rpa",
        steps: payload.steps,
        updatedAt: timestamp,
      })
    }
    if (path === "/api/behavior-chains") return Response.json(chains)
    if (path.endsWith("/tested")) return new Response(null, { status: 204 })
    if (path === "/api/skills") return Response.json(RPA_API_OPTIONS)
    if (path === "/api/behavior-anchors") return Response.json({ anchors: [] })
    if (path === "/api/devices") {
      return Response.json([
        {
          externalId: "test-box",
          host: cloudDevice.ip,
          id: cloudDevice.deviceId,
          name: cloudDevice.name,
          status: "online",
        },
      ])
    }
    if (path.endsWith("/slots")) {
      return Response.json([
        {
          height: cloudDevice.height,
          index: cloudDevice.slot,
          label: cloudDevice.name,
          rpaPort: cloudDevice.rpaPort,
          status: "online",
          width: cloudDevice.width,
        },
      ])
    }
    if (path.endsWith("/watch") || path === "/api/frames") {
      return new Response(null, { status: 204 })
    }
    if (path === "/api/tasks" && init?.method === "POST") {
      const arrange = String(init.body).includes('"skill":"ArrangeNodes"')
      return Response.json({ taskId: arrange ? "arrange-task" : "test-task" }, { status: 202 })
    }
    if (path === "/api/tasks/arrange-task") {
      return Response.json({
        errorCode: null,
        name: "节点整理",
        status: "succeeded",
        steps: [
          {
            errorCode: null,
            kind: "ArrangeNodes",
            result: { count: 1, nodes: "[{1 [8,10][40,80]}]" },
            sequence: 0,
            status: "succeeded",
          },
        ],
      })
    }
    if (path === "/api/tasks/test-task") {
      return Response.json({
        errorCode: null,
        name: "云机测试",
        status: "succeeded",
        steps: [
          {
            errorCode: null,
            kind: "OpenApp",
            result: { message: "执行完成" },
            sequence: 0,
            status: "succeeded",
          },
        ],
      })
    }
    throw new Error(`Unexpected behavior API request: ${init?.method ?? "GET"} ${path}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

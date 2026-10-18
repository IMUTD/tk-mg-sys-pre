import { vi } from "vitest"
import type { Device, DeviceCommand, DevicesApi } from "./api"

export const groupId = "11111111-1111-4111-8111-111111111111"
export const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
export const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
export const commandId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

export const makeCommand = (
  status: DeviceCommand["status"],
  result: DeviceCommand["result"] = null,
): DeviceCommand => ({
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  deviceId,
  errorCode: null,
  fingerprint: "fingerprint",
  finishedAt: status === "succeeded" || status === "cancelled" ? new Date() : null,
  groupId,
  id: commandId,
  idempotencyKey: "key",
  instanceId: null,
  kind: "health_check",
  parameters: {},
  providerReceipt: null,
  requesterId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  result,
  resultReference: null,
  startedAt: null,
  status,
  timeoutMs: 5_000,
})

export const device: Device = {
  bridge: false,
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  enabled: true,
  groupId,
  host: "192.168.1.2",
  id: deviceId,
  instances: [
    {
      createdAt: new Date("2026-09-12T00:00:00.000Z"),
      deviceId,
      enabled: true,
      id: instanceId,
      index: 1,
      label: "V3-01",
      lastHealthAt: null,
      lastHealthFailure: null,
      lastPlaybackDiagnostic: null,
      status: "unknown",
      updatedAt: new Date("2026-09-12T00:00:00.000Z"),
    },
  ],
  lastHealthAt: null,
  lastHealthFailure: null,
  model: "Magic Cloud V3",
  name: "研发机柜 A",
  resourceCount: 1,
  status: "unknown",
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
  version: null,
}

export const createApi = (): DevicesApi => ({
  owned: vi.fn().mockResolvedValue([
    {
      ...device,
      externalId: "test-box",
      boxGroupId: null,
      boxGroupName: null,
      remarks: [],
      sequenceNo: null,
      firmware: "",
      disk: "",
      diskPct: 0,
      memory: "",
      lastSeenAt: null,
    },
  ]),
  labels: vi.fn().mockResolvedValue({ administratorId: null, groups: [], remarks: [] }),
  createRemark: vi.fn(),
  deleteRemark: vi.fn(),
  createBoxGroup: vi.fn(),
  deleteBoxGroup: vi.fn(),
  assignLabels: vi.fn(),
  cancelCommand: vi.fn().mockResolvedValue(makeCommand("cancelled")),
  create: vi.fn(),
  createInstance: vi
    .fn()
    .mockResolvedValue({ ...device.instances[0], id: crypto.randomUUID(), index: 2 }),
  delete: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(device),
  getCommand: vi.fn().mockResolvedValue(makeCommand("running")),
  groups: vi.fn(),
  list: vi.fn(),
  listCommands: vi.fn(),
  status: vi.fn().mockResolvedValue({
    instances: [
      { failure: null, id: instanceId, label: "V3-01", observedAt: null, state: "unknown" },
    ],
    monitoring: { state: "unconfigured" },
    observation: { failure: null, observedAt: null, state: "unknown" },
  }),
  submitCommand: vi.fn(),
  update: vi.fn(),
  updateInstance: vi.fn().mockResolvedValue(device.instances[0]),
})

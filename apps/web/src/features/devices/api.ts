import ky from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

const InstanceSchema = z.object({
  createdAt: z.coerce.date(),
  deviceId: z.string().uuid(),
  enabled: z.boolean(),
  id: z.string().uuid(),
  index: z.number().int(),
  lastHealthAt: z.coerce.date().nullable(),
  lastHealthFailure: z.string().nullable(),
  lastPlaybackDiagnostic: z.enum(["negotiation_failed"]).nullable(),
  label: z.string(),
  status: z.enum(["unknown", "online", "offline"]),
  updatedAt: z.coerce.date(),
})

const DeviceSchema = z.object({
  bridge: z.boolean(),
  createdAt: z.coerce.date(),
  enabled: z.boolean(),
  groupId: z.string().uuid(),
  host: z.string(),
  id: z.string().uuid(),
  instances: z.array(InstanceSchema),
  lastHealthAt: z.coerce.date().nullable(),
  lastHealthFailure: z.string().nullable(),
  model: z.string(),
  name: z.string(),
  resourceCount: z.number().int(),
  status: z.enum(["unknown", "online", "offline"]),
  updatedAt: z.coerce.date(),
  version: z.string().nullable(),
})

const DeviceListSchema = z.object({ items: z.array(DeviceSchema) })

const AccessGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})
const AccessGroupListSchema = z.object({ items: z.array(AccessGroupSchema) })

const DeviceStatusSchema = z.object({
  instances: z.array(
    z.object({
      failure: z.string().nullable(),
      id: z.string().uuid(),
      label: z.string(),
      observedAt: z.coerce.date().nullable(),
      state: z.enum(["unknown", "online", "offline"]),
    }),
  ),
  monitoring: z.object({ state: z.literal("unconfigured") }),
  observation: z.object({
    failure: z.string().nullable(),
    observedAt: z.coerce.date().nullable(),
    state: z.enum(["unknown", "online", "offline"]),
  }),
})

const DeviceCommandSchema = z.object({
  createdAt: z.coerce.date(),
  deviceId: z.string().uuid(),
  errorCode: z.string().nullable(),
  fingerprint: z.string(),
  finishedAt: z.coerce.date().nullable(),
  groupId: z.string().uuid(),
  id: z.string().uuid(),
  idempotencyKey: z.string(),
  instanceId: z.string().uuid().nullable(),
  kind: z.enum([
    "health_check",
    "capture_screen",
    "launch_app",
    "stop_app",
    "tap",
    "swipe",
    "input_text",
  ]),
  parameters: z.record(z.string(), z.union([z.string(), z.number()])),
  providerReceipt: z.object({ status: z.literal("queued") }).nullable(),
  requesterId: z.string().uuid(),
  result: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("acknowledged") }),
      z.object({ kind: z.literal("no_artifact") }),
      z.object({ kind: z.literal("artifact"), reference: z.string() }),
      z.object({
        kind: z.literal("health"),
        status: z.enum(["available", "unavailable", "timed_out", "unconfigured", "rejected"]),
      }),
    ])
    .nullable(),
  resultReference: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed", "timed_out", "cancelled"]),
  timeoutMs: z.number().int(),
})

const DeviceCommandPageSchema = z.object({
  items: z.array(DeviceCommandSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})

const BoxRemarkRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})

const OwnedBoxSchema = z.object({
  boxGroupId: z.string().uuid().nullable().default(null),
  boxGroupName: z.string().nullable().default(null),
  disk: z.string().default(""),
  diskPct: z.number().int().default(0),
  enabled: z.boolean(),
  externalId: z.string(),
  firmware: z.string().default(""),
  groupId: z.string().uuid(),
  host: z.string(),
  id: z.string().uuid(),
  lastSeenAt: z.coerce.date().nullable(),
  memory: z.string().default(""),
  model: z.string().default(""),
  name: z.string(),
  remarks: z.array(BoxRemarkRefSchema).default([]),
  sequenceNo: z.number().int().min(1).max(999).nullable().default(null),
  status: z.enum(["unknown", "online", "offline"]),
  updatedAt: z.coerce.date(),
  version: z.string().nullable().default(null),
})

const BoxLabelSchema = z.object({
  administratorId: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string(),
})

const BoxLabelListSchema = z.object({
  administratorId: z.string().uuid().nullable(),
  groups: z.array(BoxLabelSchema),
  remarks: z.array(BoxLabelSchema),
})

export type Device = z.infer<typeof DeviceSchema>
export type OwnedBox = z.infer<typeof OwnedBoxSchema>
export type BoxLabel = z.infer<typeof BoxLabelSchema>
export type BoxLabelList = z.infer<typeof BoxLabelListSchema>
export type DeviceInstance = z.infer<typeof InstanceSchema>
export type AccessGroup = z.infer<typeof AccessGroupSchema>
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>
export type DeviceCommandPage = z.infer<typeof DeviceCommandPageSchema>

export interface DevicesApi {
  create(input: {
    readonly bridge: boolean
    readonly groupId: string
    readonly host: string
    readonly model: string
    readonly name: string
  }): Promise<Device>
  createInstance(input: {
    readonly deviceId: string
    readonly groupId: string
    readonly enabled?: boolean
    readonly index: number
    readonly label: string
  }): Promise<DeviceInstance>
  cancelCommand(input: {
    readonly commandId: string
    readonly deviceId: string
    readonly groupId: string
  }): Promise<DeviceCommand>
  delete(input: { readonly deviceId: string; readonly groupId: string }): Promise<void>
  deleteInstance(input: {
    readonly deviceId: string
    readonly groupId: string
    readonly instanceId: string
  }): Promise<void>
  getCommand(input: {
    readonly commandId: string
    readonly deviceId: string
    readonly groupId: string
  }): Promise<DeviceCommand>
  get(input: { readonly deviceId: string; readonly groupId: string }): Promise<Device>
  groups(): Promise<readonly AccessGroup[]>
  list(groupId: string): Promise<readonly Device[]>
  owned(): Promise<readonly OwnedBox[]>
  labels(): Promise<BoxLabelList>
  createRemark(name: string): Promise<BoxLabel>
  deleteRemark(id: string): Promise<void>
  createBoxGroup(name: string): Promise<BoxLabel>
  deleteBoxGroup(id: string): Promise<void>
  assignLabels(input: {
    readonly boxGroupId?: string | null
    readonly deviceIds: readonly string[]
    readonly remarkId?: string | null
    readonly remarkIds?: readonly string[]
    readonly remarkMode?: "add" | "replace"
    readonly sequenceNo?: number | null
  }): Promise<void>
  listCommands(input: {
    readonly deviceId: string
    readonly groupId: string
    readonly page: number
    readonly pageSize: number
  }): Promise<DeviceCommandPage>
  submitCommand(input: {
    readonly deviceId: string
    readonly groupId: string
    readonly idempotencyKey: string
    readonly instanceId?: string
    readonly type: "health_check" | "capture_screen"
  }): Promise<DeviceCommand>
  status(input: { readonly deviceId: string; readonly groupId: string }): Promise<DeviceStatus>
  update(input: {
    readonly bridge?: boolean
    readonly deviceId: string
    readonly enabled?: boolean
    readonly groupId: string
    readonly host?: string
    readonly model?: string
    readonly name?: string
    readonly version?: string | null
  }): Promise<Device>
  updateInstance(input: {
    readonly deviceId: string
    readonly enabled?: boolean
    readonly groupId: string
    readonly index?: number
    readonly instanceId: string
    readonly label?: string
  }): Promise<DeviceInstance>
}

const groupPath = (groupId: string): string => `groups/${encodeURIComponent(groupId)}/devices`

export const createDevicesApi = (apiBaseUrl = "/api"): DevicesApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    create: async (input) =>
      DeviceSchema.parse(
        await client
          .post(groupPath(input.groupId), {
            json: {
              bridge: input.bridge,
              host: input.host,
              model: input.model,
              name: input.name,
            },
          })
          .json(),
      ),
    createInstance: async (input) =>
      InstanceSchema.parse(
        await client
          .post(`${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/instances`, {
            json: { enabled: input.enabled ?? true, index: input.index, label: input.label },
          })
          .json(),
      ),
    cancelCommand: async (input) =>
      DeviceCommandSchema.parse(
        await client
          .post(
            `${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/commands/${encodeURIComponent(input.commandId)}/cancel`,
          )
          .json(),
      ),
    delete: async (input) => {
      await client.delete(`${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}`)
    },
    deleteInstance: async (input) => {
      await client.delete(
        `${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/instances/${encodeURIComponent(input.instanceId)}`,
      )
    },
    get: async (input) =>
      DeviceSchema.parse(
        await client
          .get(`${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}`)
          .json(),
      ),
    getCommand: async (input) =>
      DeviceCommandSchema.parse(
        await client
          .get(
            `${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/commands/${encodeURIComponent(input.commandId)}`,
          )
          .json(),
      ),
    groups: async () => AccessGroupListSchema.parse(await client.get("access/groups").json()).items,
    owned: async () => z.array(OwnedBoxSchema).parse(await client.get("devices").json()),
    labels: async () => BoxLabelListSchema.parse(await client.get("box-labels").json()),
    createRemark: async (name) =>
      BoxLabelSchema.parse(await client.post("box-remarks", { json: { name } }).json()),
    deleteRemark: async (id) => {
      await client.delete(`box-remarks/${encodeURIComponent(id)}`)
    },
    createBoxGroup: async (name) =>
      BoxLabelSchema.parse(await client.post("box-groups", { json: { name } }).json()),
    deleteBoxGroup: async (id) => {
      await client.delete(`box-groups/${encodeURIComponent(id)}`)
    },
    assignLabels: async (input) => {
      await client.post("devices/labels", { json: input })
    },
    list: async (groupId) =>
      DeviceListSchema.parse(await client.get(groupPath(groupId)).json()).items,
    listCommands: async (input) =>
      DeviceCommandPageSchema.parse(
        await client
          .get(`${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/commands`, {
            searchParams: { page: input.page, pageSize: input.pageSize },
          })
          .json(),
      ),
    status: async (input) =>
      DeviceStatusSchema.parse(
        await client
          .get(`${groupPath(input.groupId)}/${encodeURIComponent(input.deviceId)}/status`)
          .json(),
      ),
    submitCommand: async (input) => {
      const { deviceId: targetDeviceId, groupId: targetGroupId, ...body } = input
      return DeviceCommandSchema.parse(
        await client
          .post(`${groupPath(targetGroupId)}/${encodeURIComponent(targetDeviceId)}/commands`, {
            json: body,
          })
          .json(),
      )
    },
    update: async (input) => {
      const { deviceId, groupId, ...changes } = input
      return DeviceSchema.parse(
        await client
          .patch(`${groupPath(groupId)}/${encodeURIComponent(deviceId)}`, { json: changes })
          .json(),
      )
    },
    updateInstance: async (input) => {
      const { deviceId, groupId, instanceId, ...changes } = input
      return InstanceSchema.parse(
        await client
          .patch(
            `${groupPath(groupId)}/${encodeURIComponent(deviceId)}/instances/${encodeURIComponent(instanceId)}`,
            { json: changes },
          )
          .json(),
      )
    },
  }
}

import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type Device,
  type DeviceCreateInput,
  DeviceIdSchema,
  type DeviceInstance,
  type DeviceInstanceCreateInput,
  DeviceInstanceIdSchema,
  type DeviceInstanceUpdateInput,
  type DeviceRepository,
  type DeviceUpdateInput,
} from "./repository"

export type CreateDeviceInput = Omit<DeviceCreateInput, "groupId">
export type CreateDeviceInstanceInput = Omit<DeviceInstanceCreateInput, "deviceId">

export type DeviceStatusView = {
  readonly instances: readonly {
    readonly id: string
    readonly label: string
    readonly observedAt: Date | null
    readonly state: "unknown" | "online" | "offline"
    readonly failure: string | null
  }[]
  readonly monitoring: { readonly state: "unconfigured" }
  readonly observation: {
    readonly failure: string | null
    readonly observedAt: Date | null
    readonly state: "unknown" | "online" | "offline"
  }
}

export interface DeviceService {
  create(actorId: UserId, groupId: string, input: CreateDeviceInput): Promise<Device>
  createInstance(
    actorId: UserId,
    groupId: string,
    deviceId: string,
    input: CreateDeviceInstanceInput,
  ): Promise<DeviceInstance | null>
  delete(actorId: UserId, groupId: string, deviceId: string): Promise<boolean>
  deleteInstance(
    actorId: UserId,
    groupId: string,
    deviceId: string,
    instanceId: string,
  ): Promise<boolean>
  status(groupId: string, deviceId: string): Promise<DeviceStatusView | null>
  list(groupId: string): Promise<readonly Device[]>
  update(
    actorId: UserId,
    groupId: string,
    deviceId: string,
    input: DeviceUpdateInput,
  ): Promise<Device | null>
  updateInstance(
    actorId: UserId,
    groupId: string,
    deviceId: string,
    instanceId: string,
    input: DeviceInstanceUpdateInput,
  ): Promise<DeviceInstance | null>
}

type DeviceServiceDependencies = {
  readonly auditRepository: AuditRepository
  readonly repository: DeviceRepository
}

const writeDeviceAudit = async (
  repository: AuditRepository,
  actorId: UserId,
  action: string,
  target: string,
  groupId: string,
): Promise<void> => {
  await writeAuditEvent(repository, {
    action,
    actorId,
    metadata: { groupId },
    outcome: "allowed",
    target,
  })
}

const auditInput = (actorId: UserId, action: string, target: string, groupId: string) => ({
  action,
  actorId,
  metadata: { groupId },
  outcome: "allowed" as const,
  target,
})

const observedState = (item: Pick<Device, "lastHealthAt" | "status">): Device["status"] =>
  item.lastHealthAt === null ? "unknown" : item.status

const statusFor = (device: Device): DeviceStatusView => ({
  instances: device.instances.map((instance) => ({
    failure: instance.lastHealthFailure,
    id: instance.id,
    label: instance.label,
    observedAt: instance.lastHealthAt,
    state: observedState(instance),
  })),
  monitoring: { state: "unconfigured" },
  observation: {
    failure: device.lastHealthFailure,
    observedAt: device.lastHealthAt,
    state: observedState(device),
  },
})

export const createDeviceService = (dependencies: DeviceServiceDependencies): DeviceService => ({
  create: async (actorId, rawGroupId, input) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const device = await workflow.createDevice({ ...input, groupId })
        await workflow.appendAudit(
          auditInput(actorId, "device.create", `device:${device.id}`, groupId),
        )
        return device
      })
    }
    const device = await dependencies.repository.createDevice({ ...input, groupId })
    await writeDeviceAudit(
      dependencies.auditRepository,
      actorId,
      "device.create",
      `device:${device.id}`,
      groupId,
    )
    return device
  },
  createInstance: async (actorId, rawGroupId, rawDeviceId, input) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const device = await dependencies.repository.findDevice(
      groupId,
      DeviceIdSchema.parse(rawDeviceId),
    )
    if (device === null) {
      return null
    }
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const instance = await workflow.createInstance({ ...input, deviceId: device.id })
        if (instance !== null) {
          await workflow.appendAudit(
            auditInput(
              actorId,
              "device.instance.create",
              `device:${device.id}/instance:${instance.id}`,
              groupId,
            ),
          )
        }
        return instance
      })
    }
    const instance = await dependencies.repository.createInstance({ ...input, deviceId: device.id })
    if (instance !== null) {
      await writeDeviceAudit(
        dependencies.auditRepository,
        actorId,
        "device.instance.create",
        `device:${device.id}/instance:${instance.id}`,
        groupId,
      )
    }
    return instance
  },
  delete: async (actorId, rawGroupId, rawDeviceId) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const deviceId = DeviceIdSchema.parse(rawDeviceId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const deleted = await workflow.deleteDevice(groupId, deviceId)
        if (deleted) {
          await workflow.appendAudit(
            auditInput(actorId, "device.delete", `device:${deviceId}`, groupId),
          )
        }
        return deleted
      })
    }
    const deleted = await dependencies.repository.deleteDevice(groupId, deviceId)
    if (deleted) {
      await writeDeviceAudit(
        dependencies.auditRepository,
        actorId,
        "device.delete",
        `device:${deviceId}`,
        groupId,
      )
    }
    return deleted
  },
  deleteInstance: async (actorId, rawGroupId, rawDeviceId, rawInstanceId) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const deviceId = DeviceIdSchema.parse(rawDeviceId)
    const instanceId = DeviceInstanceIdSchema.parse(rawInstanceId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const deleted = await workflow.deleteInstance(groupId, deviceId, instanceId)
        if (deleted) {
          await workflow.appendAudit(
            auditInput(
              actorId,
              "device.instance.delete",
              `device:${deviceId}/instance:${instanceId}`,
              groupId,
            ),
          )
        }
        return deleted
      })
    }
    const deleted = await dependencies.repository.deleteInstance(groupId, deviceId, instanceId)
    if (deleted) {
      await writeDeviceAudit(
        dependencies.auditRepository,
        actorId,
        "device.instance.delete",
        `device:${deviceId}/instance:${instanceId}`,
        groupId,
      )
    }
    return deleted
  },
  list: async (rawGroupId) => dependencies.repository.list(GroupIdSchema.parse(rawGroupId)),
  status: async (rawGroupId, rawDeviceId) => {
    const device = await dependencies.repository.findDevice(
      GroupIdSchema.parse(rawGroupId),
      DeviceIdSchema.parse(rawDeviceId),
    )
    return device === null ? null : statusFor(device)
  },
  update: async (actorId, rawGroupId, rawDeviceId, input) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const deviceId = DeviceIdSchema.parse(rawDeviceId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const device = await workflow.updateDevice(groupId, deviceId, input)
        if (device !== null) {
          await workflow.appendAudit(
            auditInput(actorId, "device.update", `device:${device.id}`, groupId),
          )
        }
        return device
      })
    }
    const device = await dependencies.repository.updateDevice(groupId, deviceId, input)
    if (device !== null) {
      await writeDeviceAudit(
        dependencies.auditRepository,
        actorId,
        "device.update",
        `device:${device.id}`,
        groupId,
      )
    }
    return device
  },
  updateInstance: async (actorId, rawGroupId, rawDeviceId, rawInstanceId, input) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const deviceId = DeviceIdSchema.parse(rawDeviceId)
    const instanceId = DeviceInstanceIdSchema.parse(rawInstanceId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const instance = await workflow.updateInstance(groupId, deviceId, instanceId, input)
        if (instance !== null) {
          await workflow.appendAudit(
            auditInput(
              actorId,
              "device.instance.update",
              `device:${deviceId}/instance:${instance.id}`,
              groupId,
            ),
          )
        }
        return instance
      })
    }
    const instance = await dependencies.repository.updateInstance(
      groupId,
      deviceId,
      instanceId,
      input,
    )
    if (instance !== null) {
      await writeDeviceAudit(
        dependencies.auditRepository,
        actorId,
        "device.instance.update",
        `device:${deviceId}/instance:${instance.id}`,
        groupId,
      )
    }
    return instance
  },
})

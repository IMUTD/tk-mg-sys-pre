import { z } from "zod"

import type { GroupId } from "../../lib/authorization"
import type { Device, DeviceId, DeviceInstance, DeviceRepository } from "./repository"
import { DeviceConflictError } from "./repository"

const DeviceIdSchema = z.string().uuid().brand<"DeviceId">()
const DeviceInstanceIdSchema = z.string().uuid().brand<"DeviceInstanceId">()
const DeviceStatus = {
  Offline: "offline",
  Online: "online",
  Unknown: "unknown",
} as const

export const createInMemoryDeviceRepository = (
  initialDevices: readonly Device[],
): DeviceRepository => {
  let devices: readonly Device[] = initialDevices.map((device) => ({
    ...device,
    instances: [...device.instances],
  }))

  const findIndex = (groupId: GroupId, deviceId: DeviceId): number =>
    devices.findIndex((device) => device.groupId === groupId && device.id === deviceId)

  return {
    createDevice: async (input) => {
      const host = input.host.trim().toLowerCase()
      if (
        devices.some(
          (device) => device.groupId === input.groupId && device.host.trim().toLowerCase() === host,
        )
      ) {
        throw new DeviceConflictError("device_host_conflict")
      }
      const now = new Date()
      const device: Device = {
        ...input,
        createdAt: now,
        enabled: true,
        host,
        id: DeviceIdSchema.parse(crypto.randomUUID()),
        instances: [],
        lastHealthAt: null,
        lastHealthFailure: null,
        status: DeviceStatus.Unknown,
        updatedAt: now,
      }
      devices = [...devices, device]
      return device
    },
    createInstance: async (input) => {
      const deviceIndex = devices.findIndex((device) => device.id === input.deviceId)
      const device = devices[deviceIndex]
      if (
        device === undefined ||
        device.instances.some((instance) => instance.index === input.index)
      ) {
        throw new DeviceConflictError("device_instance_index_conflict")
      }
      const now = new Date()
      const instance: DeviceInstance = {
        ...input,
        createdAt: now,
        id: DeviceInstanceIdSchema.parse(crypto.randomUUID()),
        lastHealthAt: null,
        lastHealthFailure: null,
        lastPlaybackDiagnostic: null,
        status: DeviceStatus.Unknown,
        updatedAt: now,
      }
      const nextDevice = { ...device, instances: [...device.instances, instance], updatedAt: now }
      devices = devices.map((candidate, index) => (index === deviceIndex ? nextDevice : candidate))
      return instance
    },
    deleteDevice: async (groupId, deviceId) => {
      const previous = devices.length
      devices = devices.filter((device) => !(device.groupId === groupId && device.id === deviceId))
      return devices.length < previous
    },
    deleteInstance: async (groupId, deviceId, instanceId) => {
      const deviceIndex = findIndex(groupId, deviceId)
      const device = devices[deviceIndex]
      if (device === undefined) return false
      const previous = device.instances.length
      const instances = device.instances.filter((instance) => instance.id !== instanceId)
      if (instances.length === previous) return false
      const nextDevice = { ...device, instances, updatedAt: new Date() }
      devices = devices.map((candidate, index) => (index === deviceIndex ? nextDevice : candidate))
      return true
    },
    findDevice: async (groupId, deviceId) => {
      const index = findIndex(groupId, deviceId)
      return index === -1 ? null : (devices[index] ?? null)
    },
    findInstance: async (groupId, deviceId, instanceId) => {
      const device = devices.find(
        (candidate) => candidate.groupId === groupId && candidate.id === deviceId,
      )
      const instance = device?.instances.find((candidate) => candidate.id === instanceId)
      return device === undefined || instance === undefined ? null : { device, instance }
    },
    list: async (groupId) => devices.filter((device) => device.groupId === groupId),
    recordHealth: async (groupId, deviceId, instanceId, observation) => {
      const deviceIndex = findIndex(groupId, deviceId)
      const device = devices[deviceIndex]
      if (device === undefined) return
      const updatedInstances = device.instances.map((instance) =>
        instanceId !== null && instance.id === instanceId
          ? {
              ...instance,
              lastHealthAt: observation.observedAt,
              lastHealthFailure: observation.failure,
              status: observation.status,
              updatedAt: observation.observedAt,
            }
          : instance,
      )
      const updated: Device =
        instanceId === null
          ? {
              ...device,
              lastHealthAt: observation.observedAt,
              lastHealthFailure: observation.failure,
              status: observation.status,
              updatedAt: observation.observedAt,
            }
          : { ...device, instances: updatedInstances, updatedAt: observation.observedAt }
      devices = devices.map((candidate, index) => (index === deviceIndex ? updated : candidate))
    },
    updateDevice: async (groupId, deviceId, input) => {
      const deviceIndex = findIndex(groupId, deviceId)
      const device = devices[deviceIndex]
      if (device === undefined) {
        throw new DeviceConflictError("device_instance_index_conflict")
      }
      const updated: Device = { ...device, ...input, updatedAt: new Date() }
      devices = devices.map((candidate, index) => (index === deviceIndex ? updated : candidate))
      return updated
    },
    updateInstance: async (groupId, deviceId, instanceId, input) => {
      const deviceIndex = findIndex(groupId, deviceId)
      const device = devices[deviceIndex]
      const instance = device?.instances.find((candidate) => candidate.id === instanceId)
      if (device === undefined || instance === undefined) {
        return null
      }
      const updated = { ...instance, ...input, updatedAt: new Date() }
      if (
        device.instances.some(
          (candidate) => candidate.id !== instanceId && candidate.index === updated.index,
        )
      ) {
        return null
      }
      const nextDevice = {
        ...device,
        instances: device.instances.map((candidate) =>
          candidate.id === instanceId ? updated : candidate,
        ),
        updatedAt: updated.updatedAt,
      }
      devices = devices.map((candidate, index) => (index === deviceIndex ? nextDevice : candidate))
      return updated
    },
  }
}

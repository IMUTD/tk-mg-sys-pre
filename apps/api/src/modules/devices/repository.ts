import { z } from "zod"

import type { GroupId } from "../../lib/authorization"
import type { AuditEventInput } from "../audit/service"

export const DeviceIdSchema = z.string().uuid().brand<"DeviceId">()
export type DeviceId = z.infer<typeof DeviceIdSchema>

export const DeviceInstanceIdSchema = z.string().uuid().brand<"DeviceInstanceId">()
export type DeviceInstanceId = z.infer<typeof DeviceInstanceIdSchema>

export const DeviceStatus = {
  Offline: "offline",
  Online: "online",
  Unknown: "unknown",
} as const

export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus]

export const DeviceStatusSchema = z.enum([
  DeviceStatus.Unknown,
  DeviceStatus.Online,
  DeviceStatus.Offline,
])

export const PlaybackDiagnostic = {
  NegotiationFailed: "negotiation_failed",
} as const

export type PlaybackDiagnostic = (typeof PlaybackDiagnostic)[keyof typeof PlaybackDiagnostic]

export const PlaybackDiagnosticSchema = z.enum([PlaybackDiagnostic.NegotiationFailed])

export type DeviceConflictCode = "device_host_conflict" | "device_instance_index_conflict"

export class DeviceConflictError extends Error {
  public readonly code: DeviceConflictCode

  public constructor(code: DeviceConflictCode) {
    super(code)
    this.code = code
    this.name = "DeviceConflictError"
  }
}

export type DeviceInstance = {
  readonly createdAt: Date
  readonly deviceId: DeviceId
  readonly enabled: boolean
  readonly id: DeviceInstanceId
  readonly index: number
  readonly lastHealthAt: Date | null
  readonly lastHealthFailure: string | null
  readonly lastPlaybackDiagnostic: PlaybackDiagnostic | null
  readonly label: string
  readonly status: DeviceStatus
  readonly updatedAt: Date
}

export type Device = {
  readonly bridge: boolean
  readonly createdAt: Date
  readonly enabled: boolean
  readonly groupId: GroupId
  readonly host: string
  readonly id: DeviceId
  readonly instances: readonly DeviceInstance[]
  readonly lastHealthAt: Date | null
  readonly lastHealthFailure: string | null
  readonly model: string
  readonly name: string
  readonly resourceCount: number
  readonly status: DeviceStatus
  readonly updatedAt: Date
  readonly version: string | null
}

export type DeviceCreateInput = {
  readonly bridge: boolean
  readonly groupId: GroupId
  readonly host: string
  readonly model: string
  readonly name: string
  readonly resourceCount: number
  readonly version: string | null
}

export type DeviceUpdateInput = {
  readonly bridge?: boolean
  readonly enabled?: boolean
  readonly host?: string
  readonly model?: string
  readonly name?: string
  readonly resourceCount?: number
  readonly version?: string | null
}

export type HealthObservation = {
  readonly status: DeviceStatus
  readonly observedAt: Date
  readonly failure: string | null
}

export type DeviceInstanceCreateInput = {
  readonly deviceId: DeviceId
  readonly enabled: boolean
  readonly index: number
  readonly label: string
}

export type DeviceInstanceUpdateInput = {
  readonly enabled?: boolean
  readonly index?: number
  readonly label?: string
}

export interface DeviceRepository {
  createDevice(input: DeviceCreateInput): Promise<Device>
  createInstance(input: DeviceInstanceCreateInput): Promise<DeviceInstance | null>
  deleteDevice(groupId: GroupId, deviceId: DeviceId): Promise<boolean>
  deleteInstance(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId,
  ): Promise<boolean>
  findDevice(groupId: GroupId, deviceId: DeviceId): Promise<Device | null>
  findInstance(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId,
  ): Promise<{ readonly device: Device; readonly instance: DeviceInstance } | null>
  list(groupId: GroupId): Promise<readonly Device[]>
  recordHealth(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId | null,
    observation: HealthObservation,
  ): Promise<void>
  transaction?<Result>(
    callback: (workflow: DeviceTransactionWorkflow) => Promise<Result>,
  ): Promise<Result>
  updateDevice(
    groupId: GroupId,
    deviceId: DeviceId,
    input: DeviceUpdateInput,
  ): Promise<Device | null>
  updateInstance(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId,
    input: DeviceInstanceUpdateInput,
  ): Promise<DeviceInstance | null>
}

export interface DeviceTransactionWorkflow {
  appendAudit(input: AuditEventInput): Promise<void>
  createDevice(input: DeviceCreateInput): Promise<Device>
  createInstance(input: DeviceInstanceCreateInput): Promise<DeviceInstance | null>
  deleteDevice(groupId: GroupId, deviceId: DeviceId): Promise<boolean>
  deleteInstance(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId,
  ): Promise<boolean>
  findDevice(groupId: GroupId, deviceId: DeviceId): Promise<Device | null>
  updateDevice(
    groupId: GroupId,
    deviceId: DeviceId,
    input: DeviceUpdateInput,
  ): Promise<Device | null>
  updateInstance(
    groupId: GroupId,
    deviceId: DeviceId,
    instanceId: DeviceInstanceId,
    input: DeviceInstanceUpdateInput,
  ): Promise<DeviceInstance | null>
}

export { createInMemoryDeviceRepository } from "./in-memory-repository"

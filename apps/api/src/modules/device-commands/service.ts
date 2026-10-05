import { createHash } from "node:crypto"
import {
  DeviceIdSchema as AdapterDeviceIdSchema,
  DeviceInstanceIdSchema as AdapterInstanceIdSchema,
  type DeviceAdapter,
  type DeviceCommand,
  DeviceCommandIdSchema,
  DeviceCommandSchema,
  type DeviceHealth,
  IdempotencyKeySchema,
} from "@tk-mg/device-adapter"
import { z } from "zod"

import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import type { DeviceRepository } from "../devices/repository"
import { DeviceIdSchema, DeviceInstanceIdSchema } from "../devices/repository"
import { createDeviceCommandDispatcher } from "./dispatcher"
import {
  CommandCancellationError,
  type CommandRecord,
  type DeviceCommandRepository,
  type SafeParameters,
} from "./repository"

const BaseInput = z.object({
  idempotencyKey: z.string().min(1).max(256),
  instanceId: z.string().uuid().optional(),
  timeoutMs: z.number().int().min(1).max(30_000).default(5_000),
})
export const SubmitCommandSchema = z.discriminatedUnion("type", [
  BaseInput.extend({ type: z.literal("health_check") }),
  BaseInput.extend({ type: z.literal("capture_screen") }),
  BaseInput.extend({ type: z.literal("launch_app"), appId: z.string().min(1).max(256) }),
  BaseInput.extend({ type: z.literal("stop_app"), appId: z.string().min(1).max(256) }),
  BaseInput.extend({
    type: z.literal("tap"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  }),
  BaseInput.extend({
    type: z.literal("swipe"),
    fromX: z.number().finite().nonnegative(),
    fromY: z.number().finite().nonnegative(),
    toX: z.number().finite().nonnegative(),
    toY: z.number().finite().nonnegative(),
    durationMs: z.number().int().positive(),
  }),
  BaseInput.extend({ type: z.literal("input_text"), text: z.string().min(1).max(10_000) }),
])
export type SubmitCommand = z.infer<typeof SubmitCommandSchema>

const parametersFor = (command: DeviceCommand): SafeParameters => {
  switch (command.type) {
    case "health_check":
    case "capture_screen":
      return {}
    case "launch_app":
    case "stop_app":
      return { appId: command.appId }
    case "tap":
      return { x: command.x, y: command.y }
    case "swipe":
      return {
        fromX: command.fromX,
        fromY: command.fromY,
        toX: command.toX,
        toY: command.toY,
        durationMs: command.durationMs,
      }
    case "input_text":
      return { textLength: command.text.length }
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}

type Context = { readonly actorId: string; readonly groupId: string; readonly deviceId: string }
export interface DeviceCommandService {
  submit(
    context: Context,
    input: SubmitCommand,
  ): Promise<{ readonly command: CommandRecord; readonly created: boolean } | null>
  find(groupId: string, deviceId: string, commandId: string): Promise<CommandRecord | null>
  list(
    groupId: string,
    deviceId: string,
    page: number,
    pageSize: number,
  ): Promise<Awaited<ReturnType<DeviceCommandRepository["list"]>> | null>
  cancel(context: Context, commandId: string): Promise<CommandRecord | null>
}

type Dependencies = {
  readonly adapter: DeviceAdapter
  readonly deviceRepository: DeviceRepository
  readonly repository: DeviceCommandRepository
  readonly dispatchImmediately?: boolean
}

export const createDeviceCommandService = (dependencies: Dependencies): DeviceCommandService => {
  const dispatch = createDeviceCommandDispatcher(dependencies.repository, dependencies.adapter)
  const deviceExists = async (groupId: string, deviceId: string) => {
    const group = GroupIdSchema.safeParse(groupId)
    const device = DeviceIdSchema.safeParse(deviceId)
    if (!group.success || !device.success) return null
    return dependencies.deviceRepository.findDevice(group.data, device.data)
  }
  return {
    submit: async (context, input) => {
      const device = await deviceExists(context.groupId, context.deviceId)
      if (device === null) return null
      if (input.instanceId !== undefined) {
        const instanceId = DeviceInstanceIdSchema.parse(input.instanceId)
        if (!device.instances.some((instance) => instance.id === instanceId)) return null
      }
      const commandId = DeviceCommandIdSchema.parse(crypto.randomUUID())
      const { instanceId, ...commandInput } = input
      const command = DeviceCommandSchema.parse({
        ...commandInput,
        commandId,
        idempotencyKey: IdempotencyKeySchema.parse(
          createHash("sha256")
            .update(JSON.stringify([context.groupId, device.id, input.idempotencyKey]))
            .digest("hex"),
        ),
        target: {
          deviceId: AdapterDeviceIdSchema.parse(device.id),
          ...(instanceId === undefined
            ? {}
            : { instanceId: AdapterInstanceIdSchema.parse(instanceId) }),
        },
      })
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            groupId: context.groupId,
            target: command.target,
            timeoutMs: command.timeoutMs,
            type: command.type,
            parameters:
              command.type === "input_text"
                ? { textHash: createHash("sha256").update(command.text).digest("hex") }
                : parametersFor(command),
          }),
        )
        .digest("hex")
      const submitted = await dependencies.repository.submit(
        {
          id: commandId,
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          deviceId: device.id,
          instanceId: input.instanceId ?? null,
          groupId: context.groupId,
          requesterId: UserIdSchema.parse(context.actorId),
          kind: command.type,
          parameters: parametersFor(command),
          timeoutMs: command.timeoutMs,
        },
        {
          action: "device.command.create",
          actorId: context.actorId,
          outcome: "allowed",
          target: `device-command:${commandId}`,
          metadata: { groupId: context.groupId, deviceId: device.id },
        },
      )
      if (submitted.created && dependencies.dispatchImmediately !== false) {
        if (command.type === "health_check") {
          const claimed = await dependencies.repository.claim(commandId)
          if (claimed === null) return submitted
          const health = await dependencies.adapter.health(command.target)
          const observedAt = new Date()
          await dependencies.deviceRepository.recordHealth(
            GroupIdSchema.parse(context.groupId),
            device.id,
            input.instanceId === undefined ? null : DeviceInstanceIdSchema.parse(input.instanceId),
            healthObservation(health, observedAt),
          )
          const finished = await dependencies.repository.finish(commandId, claimed.claimToken, {
            status: health.status === "available" ? "succeeded" : "failed",
            providerReceipt: null,
            errorCode: health.status === "available" ? null : health.error.code,
            resultReference: null,
            result: { kind: "health", status: health.status },
          })
          return { command: finished ?? submitted.command, created: true }
        }
        await dispatch(command)
        const finished = await dependencies.repository.find(
          context.groupId,
          context.deviceId,
          commandId,
        )
        return { command: finished ?? submitted.command, created: true }
      }
      return submitted
    },
    find: async (groupId, deviceId, commandId) => {
      if (
        (await deviceExists(groupId, deviceId)) === null ||
        !DeviceCommandIdSchema.safeParse(commandId).success
      )
        return null
      return dependencies.repository.find(groupId, deviceId, commandId)
    },
    list: async (groupId, deviceId, page, pageSize) => {
      if ((await deviceExists(groupId, deviceId)) === null) return null
      return dependencies.repository.list(groupId, deviceId, page, pageSize)
    },
    cancel: async (context, commandId) => {
      if (
        (await deviceExists(context.groupId, context.deviceId)) === null ||
        !DeviceCommandIdSchema.safeParse(commandId).success
      )
        return null
      const outcome = await dependencies.repository.requestCancel(
        context.groupId,
        context.deviceId,
        commandId,
        {
          action: "device.command.cancel",
          actorId: context.actorId,
          outcome: "allowed",
          target: `device-command:${commandId}`,
          metadata: { groupId: context.groupId, deviceId: context.deviceId },
        },
      )
      if (
        outcome?.changed &&
        outcome.command.status === "running" &&
        outcome.command.providerReceipt !== null
      ) {
        const claimToken = outcome.command.claimToken
        if (claimToken === null) return outcome.command
        try {
          await dependencies.adapter.cancel(DeviceCommandIdSchema.parse(commandId))
          return (
            (await dependencies.repository.finalizeCancel(commandId, claimToken)) ?? outcome.command
          )
        } catch {
          await dependencies.repository.recordCancelFailure(commandId, claimToken)
          throw new CommandCancellationError()
        }
      }
      return outcome?.command ?? null
    },
  }
}

const healthObservation = (health: DeviceHealth, observedAt: Date) => {
  switch (health.status) {
    case "available":
      return { status: "online" as const, observedAt, failure: null }
    case "unavailable":
    case "rejected":
      return { status: "offline" as const, observedAt, failure: health.error.code }
    case "timed_out":
    case "unconfigured":
      return { status: "unknown" as const, observedAt, failure: health.error.code }
    default: {
      const exhaustive: never = health
      return exhaustive
    }
  }
}

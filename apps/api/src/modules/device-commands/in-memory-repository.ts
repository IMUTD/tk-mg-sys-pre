import type { AuditRepository } from "../audit/service"
import {
  CommandConflictError,
  type CommandEvent,
  type CommandRecord,
  type DeviceCommandRepository,
} from "./repository"

export const createInMemoryDeviceCommandRepository = (
  audit: AuditRepository,
): DeviceCommandRepository & { readonly events: () => readonly CommandEvent[] } => {
  const commands = new Map<string, CommandRecord>()
  const events: CommandEvent[] = []
  const recordEvent = (command: CommandRecord) => {
    events.push({ commandId: command.id, status: command.status, createdAt: new Date() })
  }
  const repository: DeviceCommandRepository & { readonly events: () => readonly CommandEvent[] } = {
    events: () => [...events],
    submit: async (input, auditInput) => {
      const existing = [...commands.values()].find(
        (command) =>
          command.groupId === input.groupId &&
          command.deviceId === input.deviceId &&
          command.idempotencyKey === input.idempotencyKey,
      )
      if (existing !== undefined) {
        if (existing.fingerprint !== input.fingerprint) throw new CommandConflictError()
        return { command: existing, created: false }
      }
      const command: CommandRecord = {
        ...input,
        status: "queued",
        providerReceipt: null,
        errorCode: null,
        resultReference: null,
        result: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        cancelRequestedAt: null,
        cancelErrorCode: null,
      }
      await audit.append(auditInput)
      commands.set(command.id, command)
      recordEvent(command)
      return { command, created: true }
    },
    find: async (groupId, deviceId, commandId) => {
      const command = commands.get(commandId)
      return command?.groupId === groupId && command.deviceId === deviceId ? command : null
    },
    list: async (groupId, deviceId, page, pageSize) => {
      const matching = [...commands.values()]
        .filter((command) => command.groupId === groupId && command.deviceId === deviceId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      return {
        items: matching.slice((page - 1) * pageSize, page * pageSize),
        total: matching.length,
        page,
        pageSize,
      }
    },
    claim: async (commandId) => {
      const command = commands.get(commandId)
      if (
        command === undefined ||
        (command.status !== "queued" &&
          !(
            command.status === "running" &&
            command.leaseExpiresAt !== null &&
            command.leaseExpiresAt.getTime() <= Date.now()
          ))
      )
        return null
      const claimToken = crypto.randomUUID()
      const now = new Date()
      const claimed: CommandRecord = {
        ...command,
        status: "running",
        startedAt: command.startedAt ?? now,
        claimToken,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + command.timeoutMs),
        attemptCount: command.attemptCount + 1,
        cancelErrorCode: null,
      }
      commands.set(commandId, claimed)
      if (command.status === "queued") recordEvent(claimed)
      return { ...claimed, command: claimed, claimToken }
    },
    renew: async (commandId, claimToken) => {
      const command = commands.get(commandId)
      if (command?.status !== "running" || command.claimToken !== claimToken) return null
      const renewed = { ...command, leaseExpiresAt: new Date(Date.now() + command.timeoutMs) }
      commands.set(commandId, renewed)
      return renewed
    },
    recordReceipt: async (commandId, claimToken, receipt) => {
      const command = commands.get(commandId)
      if (command?.status !== "running" || command.claimToken !== claimToken) return null
      const updated = { ...command, providerReceipt: receipt }
      commands.set(commandId, updated)
      return updated
    },
    finish: async (commandId, claimToken, result) => {
      const command = commands.get(commandId)
      if (command?.status !== "running" || command.claimToken !== claimToken) return null
      const finished: CommandRecord = { ...command, ...result, finishedAt: new Date() }
      commands.set(commandId, finished)
      recordEvent(finished)
      return finished
    },
    requestCancel: async (groupId, deviceId, commandId, auditInput) => {
      const command = commands.get(commandId)
      if (command?.groupId !== groupId || command.deviceId !== deviceId) return null
      if (command.status !== "queued" && command.status !== "running")
        return { command, changed: false }
      await audit.append(auditInput)
      if (command.status === "queued") {
        const cancelled = { ...command, status: "cancelled" as const, finishedAt: new Date() }
        commands.set(commandId, cancelled)
        recordEvent(cancelled)
        return { command: cancelled, changed: true }
      }
      const requested: CommandRecord = { ...command, cancelRequestedAt: new Date() }
      commands.set(commandId, requested)
      return { command: requested, changed: true }
    },
    finalizeCancel: async (commandId, claimToken) => {
      const command = commands.get(commandId)
      if (command?.claimToken !== claimToken || command.status !== "running") return null
      const cancelled = { ...command, status: "cancelled" as const, finishedAt: new Date() }
      commands.set(commandId, cancelled)
      recordEvent(cancelled)
      return cancelled
    },
    recordCancelFailure: async (commandId, claimToken) => {
      const command = commands.get(commandId)
      if (command?.claimToken !== claimToken || command.status !== "running") return null
      const failed = { ...command, cancelErrorCode: "cancel_failed" }
      commands.set(commandId, failed)
      return failed
    },
    cancel: async (groupId, deviceId, commandId, auditInput) =>
      repository.requestCancel(groupId, deviceId, commandId, auditInput),
  }
  return repository
}

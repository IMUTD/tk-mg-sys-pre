import { expect, it } from "bun:test"
import { createInMemoryDeviceAdapter } from "@tk-mg/device-adapter"

import { GroupIdSchema } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createInMemoryDeviceRepository } from "../devices/repository"
import { createInMemoryDeviceCommandRepository } from "./in-memory-repository"
import { createDeviceCommandService } from "./service"

it("dispatches the same client key independently in different groups", async () => {
  const auditRepository = createInMemoryAuditRepository()
  const devices = createInMemoryDeviceRepository([])
  const firstGroup = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
  const secondGroup = GroupIdSchema.parse("22222222-2222-4222-8222-222222222222")
  const first = await devices.createDevice({
    groupId: firstGroup,
    bridge: false,
    host: "first",
    model: "test",
    name: "first",
    resourceCount: 0,
    version: null,
  })
  const second = await devices.createDevice({
    groupId: secondGroup,
    bridge: false,
    host: "second",
    model: "test",
    name: "second",
    resourceCount: 0,
    version: null,
  })
  const service = createDeviceCommandService({
    adapter: createInMemoryDeviceAdapter(),
    deviceRepository: devices,
    repository: createInMemoryDeviceCommandRepository(auditRepository),
  })
  const actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const input = { type: "health_check", idempotencyKey: "same", timeoutMs: 5_000 } as const

  const one = await service.submit({ actorId, groupId: firstGroup, deviceId: first.id }, input)
  const two = await service.submit({ actorId, groupId: secondGroup, deviceId: second.id }, input)

  expect(one?.command.status).toBe("succeeded")
  expect(two?.command.status).toBe("succeeded")
})

it("dispatches the same client key independently to different devices in one group", async () => {
  const auditRepository = createInMemoryAuditRepository()
  const devices = createInMemoryDeviceRepository([])
  const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
  const first = await devices.createDevice({
    groupId,
    bridge: false,
    host: "first",
    model: "test",
    name: "first",
    resourceCount: 0,
    version: null,
  })
  const second = await devices.createDevice({
    groupId,
    bridge: false,
    host: "second",
    model: "test",
    name: "second",
    resourceCount: 0,
    version: null,
  })
  const service = createDeviceCommandService({
    adapter: createInMemoryDeviceAdapter(),
    deviceRepository: devices,
    repository: createInMemoryDeviceCommandRepository(auditRepository),
  })
  const actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const input = { type: "health_check", idempotencyKey: "same", timeoutMs: 5_000 } as const

  const one = await service.submit({ actorId, groupId, deviceId: first.id }, input)
  const two = await service.submit({ actorId, groupId, deviceId: second.id }, input)

  expect(one?.command.id).not.toBe(two?.command.id)
})

it("keeps cancellation terminal when adapter submission resolves later", async () => {
  const auditRepository = createInMemoryAuditRepository()
  const devices = createInMemoryDeviceRepository([])
  const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
  const device = await devices.createDevice({
    groupId,
    bridge: false,
    host: "first",
    model: "test",
    name: "first",
    resourceCount: 0,
    version: null,
  })
  const repository = createInMemoryDeviceCommandRepository(auditRepository)
  const underlying = createInMemoryDeviceAdapter()
  let signalSubmitted = () => {}
  const submitting = new Promise<void>((resolve) => {
    signalSubmitted = resolve
  })
  let resume = () => {}
  const waiting = new Promise<void>((resolve) => {
    resume = resolve
  })
  const adapter = {
    ...underlying,
    submit: async (command: Parameters<typeof underlying.submit>[0]) => {
      signalSubmitted()
      await waiting
      return underlying.submit(command)
    },
  }
  const service = createDeviceCommandService({ adapter, deviceRepository: devices, repository })
  const context = { actorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", groupId, deviceId: device.id }
  const pending = service.submit(context, {
    type: "capture_screen",
    idempotencyKey: "late",
    timeoutMs: 5_000,
  })
  await submitting
  const queued = await repository.list(groupId, device.id, 1, 10)
  const commandId = queued.items[0]?.id ?? ""

  const cancelled = await service.cancel(context, commandId)
  resume()
  await pending

  expect(cancelled?.status).toBe("running")
  expect(cancelled?.cancelRequestedAt).not.toBeNull()
  expect((await repository.find(groupId, device.id, commandId))?.status).toBe("cancelled")
  expect(repository.events().map((event) => event.status)).toEqual([
    "queued",
    "running",
    "cancelled",
  ])
})

import { describe, expect, it } from "bun:test"

import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createInMemoryDeviceRepository } from "./repository"
import { createDeviceService } from "./service"

describe("createDeviceService", () => {
  it("creates a device without calling box APIs", async () => {
    const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
    const service = createDeviceService({
      auditRepository: createInMemoryAuditRepository(),
      repository: createInMemoryDeviceRepository([]),
    })

    const device = await service.create(
      UserIdSchema.parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      groupId,
      {
        bridge: false,
        host: "192.168.1.2",
        model: "Magic Cloud V3",
        name: "机柜 A",
        resourceCount: 1,
        version: null,
      },
    )

    expect(device.host).toBe("192.168.1.2")
    expect(await service.list(groupId)).toEqual([expect.objectContaining({ id: device.id })])
  })
})

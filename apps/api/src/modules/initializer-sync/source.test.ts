import { describe, expect, it } from "bun:test"
import postgres from "postgres"
import { SyncConfigurationSchema } from "../../init-sync"
import { readInitializerSnapshot, SnapshotSchema } from "./source"

describe("initializer source safety", () => {
  it("requires independent databases and bounded polling", () => {
    expect(
      SyncConfigurationSchema.safeParse({
        DATABASE_URL: "postgres://target@localhost/business",
        INIT_SOURCE_DATABASE_URL: "postgres://reader@localhost/business",
      }).success,
    ).toBe(false)
    expect(
      SyncConfigurationSchema.parse({
        DATABASE_URL: "postgres://target@localhost/business",
        INIT_SOURCE_DATABASE_URL: "postgres://reader@localhost/initializer",
      }).INIT_SYNC_INTERVAL_MS,
    ).toBe(5000)
    expect(
      SnapshotSchema.safeParse({
        admins: [],
        boxes: [
          {
            id: "box",
            ip: "192.0.2.1",
            type: "",
            firmware: "",
            memory: "",
            memoryPct: 0,
            disk: "",
            diskPct: 0,
            online: false,
            lastSeenAt: null,
            adminId: "missing",
          },
        ],
      }).success,
    ).toBe(false)
  })

  const url = Bun.env["INIT_SOURCE_TEST_DATABASE_URL"]
  const sourceTest = url === undefined ? it.skip : it
  sourceTest(
    "reads only hashes with a read-only role; source failure does not produce an empty snapshot",
    async () => {
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_")) {
        throw new Error("Initializer tests require a disposable tk_mg_test_* database")
      }
      const source = postgres(url, { max: 1, connect_timeout: 2 })
      try {
        const snapshot = await readInitializerSnapshot(source)
        expect(snapshot.admins.length).toBeGreaterThan(0)
        expect(snapshot.admins.every((admin) => admin.passwordHash.startsWith("$2"))).toBe(true)
        expect(snapshot.admins[0]).not.toHaveProperty("password")
        await expect(
          source`select password from init_admin`.execute().then((rows) => rows),
        ).rejects.toHaveProperty("code", "42501")
        await expect(
          source`update init_admin set enabled = false`.execute().then((rows) => rows),
        ).rejects.toHaveProperty("code", "42501")
        const inaccessible = postgres(url, {
          max: 1,
          connect_timeout: 2,
          connection: { search_path: "nonexistent_initializer_schema" },
        })
        try {
          await expect(readInitializerSnapshot(inaccessible)).rejects.toHaveProperty(
            "code",
            "42P01",
          )
        } finally {
          await inaccessible.end({ timeout: 2 })
        }
      } finally {
        await source.end({ timeout: 2 })
      }
    },
  )
})

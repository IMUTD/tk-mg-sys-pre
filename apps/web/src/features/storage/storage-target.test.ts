import { describe, expect, it } from "vitest"
import {
  advanceBackup,
  emptyTarget,
  filterTargets,
  startBackup,
  testConnection,
  validateTarget,
} from "./storage-target"
import { createTestTargets } from "./storage-target.test-fixtures"

describe("storage-target", () => {
  it("splits seed targets into NAS and SQL lists", () => {
    const targets = createTestTargets()
    expect(filterTargets(targets, "nas").map((item) => item.name)).toEqual(["归档 NAS", "主 NAS"])
    expect(filterTargets(targets, "sql").map((item) => item.name)).toEqual(["媒体库", "运营库"])
  })

  it("rejects incomplete SQL targets and keeps secrets out of public labels", () => {
    const invalid = emptyTarget("sql", 0, "2026-09-17 12:00:00")
    expect(validateTarget(invalid)).toBe("请填写名称")
    const mysql = createTestTargets().find((item) => item.name === "媒体库")
    if (mysql === undefined) throw new Error("missing seed")
    expect(testConnection(mysql)).toEqual({
      message: "无法连接到目标，请检查主机、端口和凭据",
      ok: false,
    })
    const nas = createTestTargets().find((item) => item.name === "主 NAS")
    if (nas === undefined) throw new Error("missing seed")
    expect(testConnection(nas)).toMatchObject({ ok: true })
  })

  it("advances a running backup to completion", () => {
    const nas = createTestTargets().find((item) => item.name === "主 NAS")
    if (nas === undefined) throw new Error("missing seed")
    const started = startBackup(nas, "full")
    let current = started
    for (let index = 0; index < 8; index += 1) {
      current = advanceBackup(current, "2026-09-17 18:00:00")
    }
    expect(current.backup).toMatchObject({ percent: 100, status: "success" })
    expect(current.lastBackupAt).toBe("2026-09-17 18:00:00")
  })
})

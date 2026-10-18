import { describe, expect, it } from "vitest"

import {
  advanceRun,
  displayStatus,
  duplicateRobot,
  emptyRobot,
  sortRobots,
  startRun,
  toggleEnabled,
  validateRobot,
} from "./robot"
import { createRobotFixtures } from "./robot.test-fixtures"

describe("robot", () => {
  it("lists all robots without splitting AI and automatic kinds", () => {
    expect(sortRobots(createRobotFixtures()).map((item) => item.name)).toEqual([
      "夜间巡检",
      "晚班日更",
      "英文区补号",
      "美区养号",
    ])
  })

  it("requires a behavior chain and does not keep prompt secrets", () => {
    const invalid = emptyRobot(0, "2026-09-17 12:00:00")
    expect(validateRobot(invalid)).toBe("请填写名称")
    const named = { ...invalid, name: "试运行" }
    expect(validateRobot(named)).toBe("请选择行为链")
    const ready = createRobotFixtures().find((item) => item.name === "美区养号")
    if (ready === undefined) throw new Error("missing seed")
    expect(displayStatus(ready)).toBe("idle")
    expect(ready.chainName).toBe("早班养号")
  })

  it("advances a running cycle to completion", () => {
    const robot = createRobotFixtures().find((item) => item.name === "美区养号")
    if (robot === undefined) throw new Error("missing seed")
    let current = startRun(robot)
    for (let index = 0; index < 8; index += 1) {
      current = advanceRun(current, "2026-09-17 18:00:00")
    }
    expect(current.run).toMatchObject({ percent: 100, status: "success", total: 48 })
    expect(current.lastRunAt).toBe("2026-09-17 18:00:00")
    expect(current.logs.at(-1)).toContain("完成 48/48")
  })

  it("pauses a running robot when disabled and copies without the live run", () => {
    const robot = createRobotFixtures().find((item) => item.name === "美区养号")
    if (robot === undefined) throw new Error("missing seed")
    const running = startRun(robot)
    const paused = toggleEnabled(running, false, "2026-09-17 18:01:00")
    expect(paused.enabled).toBe(false)
    expect(paused.run.status).toBe("idle")
    expect(displayStatus(paused)).toBe("paused")
    const copy = duplicateRobot(robot, 9, "2026-09-17 18:02:00")
    expect(copy.name).toBe("美区养号 副本")
    expect(copy.enabled).toBe(false)
    expect(copy.chainName).toBe("早班养号")
  })
})

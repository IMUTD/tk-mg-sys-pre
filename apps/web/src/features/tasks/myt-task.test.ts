import { describe, expect, it } from "vitest"

import {
  calcProgress,
  childTasksOf,
  createTasksFromForm,
  deleteTasks,
  emptyTaskQuery,
  filterTasks,
  killTasks,
  startTasks,
  taskLogLines,
} from "./myt-task"

import { createTaskFixtures } from "./myt-task.test-fixtures"

describe("myt-task", () => {
  it("filters seed tasks by 云大师 query fields and hides children by default", () => {
    const tasks = createTaskFixtures()
    const mains = filterTasks(tasks, emptyTaskQuery())
    const all = filterTasks(tasks, { ...emptyTaskQuery(), main: "all" })
    const byId = filterTasks(tasks, { ...emptyTaskQuery(), id: "5005", main: "all" })
    const idStillRespectsMain = filterTasks(tasks, { ...emptyTaskQuery(), id: "5005" })
    const running = filterTasks(tasks, { ...emptyTaskQuery(), status: "2" })
    const templates = filterTasks(tasks, { ...emptyTaskQuery(), template: "true" })
    const byName = filterTasks(tasks, { ...emptyTaskQuery(), name: "养号" })
    const byScript = filterTasks(tasks, { ...emptyTaskQuery(), scriptName: "升级" })

    expect(mains.map((item) => item.id)).toEqual([5001, 5002, 5003, 5004, 5006])
    expect(all.map((item) => item.id)).toEqual([5001, 5002, 5003, 5004, 5005, 5006])
    expect(byId.map((item) => item.id)).toEqual([5005])
    expect(idStillRespectsMain).toEqual([])
    expect(running.map((item) => item.id)).toEqual([5003])
    expect(templates.map((item) => item.id)).toEqual([5006])
    expect(byName.map((item) => item.id)).toEqual([5003])
    expect(byScript.map((item) => item.id)).toEqual([5002])
    expect(childTasksOf(tasks, 5003).map((item) => item.id)).toEqual([5005])
  })

  it("starts paused tasks, kills running tasks and deletes children with the parent", () => {
    const tasks = createTaskFixtures()
    const started = startTasks(tasks, [5001, 5003], "2026-09-17 12:00:00")
    const killed = killTasks(started, [5003, 5005], "2026-09-17 12:01:00")
    const removed = deleteTasks(killed, [5003], true)

    expect(started.find((item) => item.id === 5001)?.status).toBe("2")
    expect(started.find((item) => item.id === 5003)?.status).toBe("2")
    expect(killed.find((item) => item.id === 5003)?.status).toBe("5")
    expect(removed.map((item) => item.id)).toEqual([5001, 5002, 5004, 5006])
  })

  it("creates a main task plus children from device/slot combos", () => {
    const created = createTasksFromForm(
      {
        delayTime: 5,
        deviceIds: [23849, 23847],
        deviceSeqs: [1, 2],
        immediate: true,
        name: "批量发布",
        planTime: null,
        proxyIds: [],
        remark: "立即",
        script: { code: "publish", id: 12, name: "publish", title: "批量发布", version: "1.2.0" },
        template: false,
      },
      6001,
      "2026-09-17 12:00:00",
    )

    expect(created).toHaveLength(4)
    expect(created[0]).toMatchObject({
      childCount: 3,
      deviceId: 23849,
      deviceSeq: 1,
      executeTotal: 4,
      id: 6001,
      main: true,
      status: "2",
    })
    expect(created.slice(1).every((item) => item.pid === 6001 && item.main === false)).toBe(true)
    const nurture = createTaskFixtures().find((item) => item.id === 5003)
    const unpublished = createTaskFixtures().find((item) => item.id === 5001)
    if (nurture === undefined || unpublished === undefined) throw new Error("missing seed task")
    expect(calcProgress(nurture)).toBe(25)
    expect(taskLogLines(unpublished)).toContain("等待手动启动，创建后不会自动执行")
  })
})

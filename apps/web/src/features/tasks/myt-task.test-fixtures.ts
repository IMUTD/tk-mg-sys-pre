import { emptyTask, type MytTask, type TaskDevice, type TaskScript } from "./myt-task"

const timestamp = "2026-09-17 10:00:00"

export const createTaskFixtures = (): MytTask[] => [
  { ...emptyTask(5001, timestamp), name: "发布任务", scriptName: "发布", scriptId: 12 },
  { ...emptyTask(5002, timestamp), name: "升级任务", scriptName: "升级中控", scriptId: 61 },
  {
    ...emptyTask(5003, timestamp),
    childCount: 1,
    deviceId: 23849,
    deviceSeq: 1,
    executeCount: 1,
    executeTime: timestamp,
    executeTotal: 4,
    name: "养号任务",
    scriptId: 11,
    scriptName: "养号",
    status: "2",
  },
  { ...emptyTask(5004, timestamp), name: "完成任务", status: "3" },
  { ...emptyTask(5005, timestamp), main: false, name: "养号子任务", pid: 5003, status: "2" },
  { ...emptyTask(5006, timestamp), name: "任务模板", template: true },
]

export const createTaskDeviceFixtures = (): TaskDevice[] => [
  { id: 23849, ip: "192.168.76.130", name: "270-亮18", serial: "test-device", tag: "测试组" },
  { id: 23847, ip: "192.168.76.131", name: "264-亮17", serial: "test-device-2", tag: "测试组" },
]

export const createTaskScriptFixtures = (): TaskScript[] => [
  { code: "nurture", id: 11, name: "nurture", title: "养号", version: "2.0.1" },
  { code: "publish", id: 12, name: "publish", title: "发布", version: "1.2.0" },
  { code: "upgrade", id: 61, name: "upgrade", title: "升级中控", version: "1.0.0" },
]

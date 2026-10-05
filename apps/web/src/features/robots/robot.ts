export const POOL_OPTIONS = [
  { label: "1107养号", value: "1107养号" },
  { label: "英文区池", value: "英文区池" },
  { label: "gen-1108测试", value: "gen-1108测试" },
] as const

export const DEVICE_GROUP_OPTIONS = [
  { label: "全部盒子", value: "全部盒子" },
  { label: "亮2", value: "亮2" },
  { label: "美国区盒子", value: "美国区盒子" },
] as const

export const SCHEDULE_CYCLE_OPTIONS = [
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" },
  { label: "间隔", value: "interval" },
] as const

export const WEEKDAY_OPTIONS = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 7 },
] as const

export type ScheduleCycle = (typeof SCHEDULE_CYCLE_OPTIONS)[number]["value"]
export type RobotHealth = "idle" | "running" | "paused" | "error"
export type RunStatus = "idle" | "running" | "success" | "failed"

export type RobotSchedule = {
  cycle: ScheduleCycle
  enabled: boolean
  intervalHours: number
  time: string
  weekday: number
}

export type RobotRun = {
  done: number
  percent: number
  status: RunStatus
  total: number
}

export type Robot = {
  accountCount: number
  chainId: number
  chainName: string
  concurrency: number
  deviceGroup: string
  durationMinutes: number
  enabled: boolean
  failNext: boolean
  id: number
  lastRunAt: string
  logs: string[]
  name: string
  nextRunAt: string
  poolName: string
  remark: string
  run: RobotRun
  schedule: RobotSchedule
  updateTime: string
}

export const RUN_STEP = 20

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const emptySchedule = (): RobotSchedule => ({
  cycle: "daily",
  enabled: false,
  intervalHours: 4,
  time: "09:00",
  weekday: 1,
})

export const idleRun = (total = 0): RobotRun => ({
  done: 0,
  percent: 0,
  status: "idle",
  total,
})

export const emptyRobot = (id: number, now: string): Robot => ({
  accountCount: 20,
  chainId: 0,
  chainName: "",
  concurrency: 2,
  deviceGroup: "全部盒子",
  durationMinutes: 18,
  enabled: true,
  failNext: false,
  id,
  lastRunAt: "",
  logs: [],
  name: "",
  nextRunAt: "",
  poolName: "1107养号",
  remark: "",
  run: idleRun(20),
  schedule: emptySchedule(),
  updateTime: now,
})

export const displayStatus = (robot: Robot): RobotHealth => {
  if (robot.run.status === "running") return "running"
  if (robot.run.status === "failed") return "error"
  if (!robot.enabled) return "paused"
  return "idle"
}

export const statusLabel = (status: RobotHealth): string => {
  if (status === "running") return "执行中"
  if (status === "paused") return "已暂停"
  if (status === "error") return "异常"
  return "空闲"
}

export const statusColor = (status: RobotHealth): string => {
  if (status === "running") return "processing"
  if (status === "paused") return "default"
  if (status === "error") return "error"
  return "success"
}

export const scheduleLabel = (schedule: RobotSchedule): string => {
  if (!schedule.enabled) return "未启用"
  if (schedule.cycle === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find((item) => item.value === schedule.weekday)?.label ?? ""
    return `每周${weekday} ${schedule.time}`
  }
  if (schedule.cycle === "interval") return `每 ${schedule.intervalHours} 小时`
  return `每天 ${schedule.time}`
}

export const nextRunFromSchedule = (schedule: RobotSchedule, now: string): string => {
  if (!schedule.enabled) return ""
  const day = now.slice(0, 10)
  if (schedule.cycle === "interval") return `${day} ${schedule.time}`
  return `${day} ${schedule.time}`
}

export const scopeText = (robot: Robot): string =>
  `${robot.chainName} · ${robot.poolName} · ${robot.deviceGroup} · ${robot.accountCount} 个账号`

export const validateRobot = (robot: Robot): string | null => {
  if (robot.name.trim().length === 0) return "请填写名称"
  if (robot.poolName.trim().length === 0) return "请选择账号池"
  if (robot.deviceGroup.trim().length === 0) return "请选择盒子组"
  if (robot.accountCount <= 0) return "请填写本周期账号数"
  if (robot.concurrency <= 0) return "请填写并发"
  if (robot.durationMinutes <= 0) return "请填写每号时长"
  if (robot.chainId <= 0 || robot.chainName.trim().length === 0) return "请选择行为链"
  return null
}

export const duplicateRobot = (robot: Robot, id: number, now: string): Robot => ({
  ...robot,
  enabled: false,
  id,
  lastRunAt: "",
  name: `${robot.name} 副本`,
  nextRunAt: "",
  run: idleRun(robot.accountCount),
  updateTime: now,
})

export const startRun = (robot: Robot): Robot => ({
  ...robot,
  enabled: true,
  run: {
    done: 0,
    percent: 8,
    status: "running",
    total: robot.accountCount,
  },
})

const appendLog = (logs: readonly string[], line: string): string[] => [...logs, line].slice(-12)

export const advanceRun = (robot: Robot, now: string): Robot => {
  if (robot.run.status !== "running") return robot
  const percent = Math.min(100, robot.run.percent + RUN_STEP)
  const total = robot.run.total
  const done = Math.min(total, Math.round((percent / 100) * total))
  if (percent < 100) {
    return { ...robot, run: { ...robot.run, done, percent } }
  }
  if (robot.failNext) {
    return {
      ...robot,
      lastRunAt: now,
      logs: appendLog(robot.logs, `[${now}] 执行失败 ${done}/${total}`),
      run: { done, percent: 100, status: "failed", total },
      updateTime: now,
    }
  }
  return {
    ...robot,
    lastRunAt: now,
    logs: appendLog(robot.logs, `[${now}] 完成 ${total}/${total}`),
    nextRunAt: nextRunFromSchedule(robot.schedule, now),
    run: { done: total, percent: 100, status: "success", total },
    updateTime: now,
  }
}

export const toggleEnabled = (robot: Robot, enabled: boolean, now: string): Robot => {
  if (!enabled && robot.run.status === "running") {
    return {
      ...robot,
      enabled: false,
      run: idleRun(robot.accountCount),
      updateTime: now,
    }
  }
  return { ...robot, enabled, updateTime: now }
}

export const sortRobots = (robots: readonly Robot[]): Robot[] =>
  robots.slice().sort((left, right) => right.id - left.id)

export const createSeedRobots = (): Robot[] => []

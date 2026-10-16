export const TASK_STATUS_OPTIONS = [
  { label: "未启动", value: "0" },
  { label: "排队中", value: "1" },
  { label: "执行中", value: "2" },
  { label: "已完成", value: "3" },
  { label: "失败", value: "4" },
  { label: "已终止", value: "5" },
  { label: "已暂停", value: "6" },
] as const

export const TEMPLATE_OPTIONS = [
  { label: "是", value: "true" },
  { label: "否", value: "false" },
] as const

export const MAIN_TASK_OPTIONS = [
  { label: "仅查看主任务", value: "true" },
  { label: "查看所有任务", value: "all" },
] as const

export const DEVICE_SEQ_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export const SEQ_EMOJI: Record<number, string> = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
  9: "9️⃣",
  10: "🔟",
  11: "1️⃣1️⃣",
  12: "1️⃣2️⃣",
}

export type TaskStatus = (typeof TASK_STATUS_OPTIONS)[number]["value"]

export type TaskDevice = {
  id: number
  ip: string
  name: string
  serial: string
  tag: string
}

export type TaskScript = {
  code: string
  id: number
  name: string
  title: string
  version: string
}

export type MytTask = {
  childCount: number
  createTime: string
  delayTime: number
  deviceId: number | null
  deviceIds: readonly number[]
  deviceSeq: number | null
  deviceSeqs: readonly number[]
  enable: boolean
  executeCount: number
  executeTime: string | null
  executeTotal: number
  id: number
  main: boolean
  name: string
  params: string
  pid: number | null
  planTime: string | null
  proxyIds: readonly number[]
  remark: string
  scriptCode: string
  scriptId: number
  scriptName: string
  status: TaskStatus
  template: boolean
  updateTime: string
}

export type TaskQuery = {
  deviceId: string
  deviceSeq: string
  id: string
  main: string
  name: string
  scriptName: string
  status: string
  template: string
}

export const emptyTaskQuery = (): TaskQuery => ({
  deviceId: "",
  deviceSeq: "",
  id: "",
  main: "true",
  name: "",
  scriptName: "",
  status: "",
  template: "",
})

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

export const shortDate = (value: string | null): string => {
  if (value === null || value.length === 0) return "-"
  const date = new Date(value.replace(" ", "T"))
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (diffDays === 0) return time
  if (diffDays === -1) return `昨天 ${time}`
  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const hm = time.slice(0, 5)
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${hm}`
  return `${date.getFullYear()}-${monthDay} ${hm}`
}

export const taskStatusLabel = (status: string): string =>
  TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status

export const taskStatusColor = (status: string): string => {
  if (status === "2") return "processing"
  if (status === "3") return "success"
  if (status === "4" || status === "5") return "error"
  if (status === "1" || status === "6") return "warning"
  return "default"
}

export const calcProgress = (task: MytTask): number =>
  Math.min(100, Math.floor(((task.executeCount || 0) / (task.executeTotal || 1)) * 100))

export const emptyTask = (id: number, now: string): MytTask => ({
  childCount: 0,
  createTime: now,
  delayTime: 0,
  deviceId: null,
  deviceIds: [],
  deviceSeq: null,
  deviceSeqs: [],
  enable: true,
  executeCount: 0,
  executeTime: null,
  executeTotal: 1,
  id,
  main: true,
  name: "",
  params: "",
  pid: null,
  planTime: null,
  proxyIds: [],
  remark: "",
  scriptCode: "",
  scriptId: 0,
  scriptName: "",
  status: "0",
  template: false,
  updateTime: now,
})

export const createSeedTaskDevices = (): TaskDevice[] => []

export const createSeedTaskScripts = (): TaskScript[] => []

export const scriptById = (scripts: readonly TaskScript[], id: number): TaskScript | undefined =>
  scripts.find((item) => item.id === id)

export const deviceById = (devices: readonly TaskDevice[], id: number | null): TaskDevice | null =>
  id === null ? null : (devices.find((item) => item.id === id) ?? null)

export const deviceLabel = (device: TaskDevice | null, seq: number | null): string => {
  if (device === null) return "-"
  const emoji = seq === null ? "" : (SEQ_EMOJI[seq] ?? String(seq))
  return `${device.name}${emoji}`
}

export const groupedDeviceOptions = (
  devices: readonly TaskDevice[],
): { label: string; options: { label: string; value: number }[] }[] => {
  const groups = new Map<string, TaskDevice[]>()
  for (const device of devices) {
    const tag = device.tag.length === 0 ? "未分组" : device.tag
    const current = groups.get(tag) ?? []
    current.push(device)
    groups.set(tag, current)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "未分组") return 1
      if (right === "未分组") return -1
      return left.localeCompare(right, "zh-CN")
    })
    .map(([label, items]) => ({
      label,
      options: items
        .slice()
        .sort((left, right) => right.id - left.id)
        .map((item) => ({ label: `${item.ip}-${item.name}`, value: item.id })),
    }))
}

export const filterTasks = (tasks: readonly MytTask[], query: TaskQuery): MytTask[] =>
  tasks.filter((item) => {
    if (query.id.trim().length > 0 && String(item.id) !== query.id.trim()) return false
    if (query.main === "true" && !item.main) return false
    if (
      query.name.trim().length > 0 &&
      !item.name.toLowerCase().includes(query.name.trim().toLowerCase())
    )
      return false
    if (
      query.scriptName.trim().length > 0 &&
      !item.scriptName.toLowerCase().includes(query.scriptName.trim().toLowerCase())
    )
      return false
    if (query.deviceId.length > 0 && item.deviceId !== Number(query.deviceId)) return false
    if (query.deviceSeq.length > 0 && item.deviceSeq !== Number(query.deviceSeq)) return false
    if (query.status.length > 0 && item.status !== query.status) return false
    if (query.template === "true" && !item.template) return false
    if (query.template === "false" && item.template) return false
    return true
  })

export const childTasksOf = (tasks: readonly MytTask[], pid: number): MytTask[] =>
  tasks.filter((item) => item.pid === pid)

export const runningTasks = (tasks: readonly MytTask[]): MytTask[] =>
  tasks.filter((item) => item.status === "2")

export const startTasks = (
  tasks: readonly MytTask[],
  ids: readonly number[],
  now: string,
): MytTask[] => {
  const idSet = new Set(ids)
  return tasks.map((item) =>
    idSet.has(item.id) && (item.status === "0" || item.status === "6")
      ? { ...item, executeTime: now, status: "2", updateTime: now }
      : item,
  )
}

export const killTasks = (
  tasks: readonly MytTask[],
  ids: readonly number[],
  now: string,
): MytTask[] => {
  const idSet = new Set(ids)
  return tasks.map((item) =>
    idSet.has(item.id) && (item.status === "1" || item.status === "2" || item.status === "6")
      ? { ...item, status: "5", updateTime: now }
      : item,
  )
}

export const deleteTasks = (
  tasks: readonly MytTask[],
  ids: readonly number[],
  withChildren: boolean,
): MytTask[] => {
  const idSet = new Set(ids)
  if (withChildren) {
    for (const item of tasks) {
      if (item.pid !== null && idSet.has(item.pid)) idSet.add(item.id)
    }
  }
  return tasks.filter((item) => !idSet.has(item.id))
}

export const createTasksFromForm = (
  input: {
    delayTime: number
    deviceIds: readonly number[]
    deviceSeqs: readonly number[]
    immediate: boolean
    name: string
    planTime: string | null
    proxyIds: readonly number[]
    remark: string
    script: TaskScript
    template: boolean
  },
  nextId: number,
  now: string,
): MytTask[] => {
  const combos: { deviceId: number; deviceSeq: number }[] = []
  for (const deviceId of input.deviceIds) {
    for (const deviceSeq of input.deviceSeqs) combos.push({ deviceId, deviceSeq })
  }
  const rows =
    combos.length > 0
      ? combos
      : [{ deviceId: input.deviceIds[0] ?? 0, deviceSeq: input.deviceSeqs[0] ?? 1 }]
  const status: TaskStatus = input.immediate ? "2" : "0"
  const executeTime = input.immediate ? now : null
  const main: MytTask = {
    ...emptyTask(nextId, now),
    childCount: Math.max(0, rows.length - 1),
    delayTime: input.delayTime,
    deviceId: rows[0]?.deviceId ?? null,
    deviceIds: input.deviceIds,
    deviceSeq: rows[0]?.deviceSeq ?? null,
    deviceSeqs: input.deviceSeqs,
    executeTime,
    executeTotal: rows.length,
    name: input.name,
    planTime: input.planTime,
    proxyIds: input.proxyIds,
    remark: input.remark,
    scriptCode: input.script.code,
    scriptId: input.script.id,
    scriptName: input.script.title,
    status,
    template: input.template,
  }
  const children = rows.slice(1).map((row, index) => ({
    ...main,
    childCount: 0,
    deviceId: row.deviceId,
    deviceSeq: row.deviceSeq,
    executeTotal: 1,
    id: nextId + index + 1,
    main: false,
    pid: nextId,
  }))
  return [main, ...children]
}

export const taskLogLines = (task: MytTask): string[] => {
  const lines = [`${task.createTime} 创建任务 ${task.name}`]
  if (task.planTime !== null) lines.push(`${task.planTime} 计划启动`)
  if (task.executeTime !== null) lines.push(`${task.executeTime} 开始执行 ${task.scriptName}`)
  if (task.status === "3") lines.push(`${task.updateTime} 执行完成`)
  if (task.status === "4") lines.push(`${task.updateTime} 执行失败`)
  if (task.status === "5") lines.push(`${task.updateTime} 任务已终止`)
  if (task.status === "0") lines.push("等待手动启动，创建后不会自动执行")
  return lines
}

export const createSeedTasks = (): MytTask[] => []

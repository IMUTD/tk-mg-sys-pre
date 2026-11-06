const HIDDEN_SOURCES = new Set([
  "proxy.password",
  "proxy.username",
  "proxy.link",
  "proxy.safe",
  "proxy.tun",
])

const DONE = new Set(["succeeded", "failed", "cancelled"])

export type ProgressTone = "exception" | "normal" | "partial" | "success"

export const isRunFinished = (status: string): boolean => DONE.has(status)

export const countFinished = (statuses: readonly string[]): number =>
  statuses.filter((status) => isRunFinished(status) || status === "partial").length

export const rollupTone = (statuses: readonly string[], finished: number): ProgressTone => {
  const total = statuses.length
  const failed = failedCount(statuses)
  const partial = statuses.filter((status) => status === "partial").length
  if (total > 0 && failed === total) return "exception"
  if (failed > 0 || partial > 0) return "partial"
  return progressTone(finished, total, 0)
}

export const failedCount = (statuses: readonly string[]): number =>
  statuses.filter((status) => status === "failed").length

export const progressTone = (finished: number, total: number, failed: number): ProgressTone => {
  if (total > 0 && failed >= total) return "exception"
  if (failed > 0) return "partial"
  if (total > 0 && finished === total) return "success"
  return "normal"
}

export const dispatchTimes = (
  taskCount: number,
  taskFinished: number,
  tasks: readonly { readonly createdAt: Date; readonly finishedAt: Date | null }[],
): { readonly finishedAt: string | null; readonly startedAt: string | null } => {
  let started: Date | null = null
  let finished: Date | null = null
  for (const task of tasks) {
    if (started === null || task.createdAt < started) started = task.createdAt
    if (task.finishedAt !== null && (finished === null || task.finishedAt > finished)) {
      finished = task.finishedAt
    }
  }
  if (started === null) return { finishedAt: null, startedAt: null }
  const done = taskCount > 0 && taskFinished === taskCount && finished !== null
  return {
    finishedAt: done ? finished.toISOString() : null,
    startedAt: started.toISOString(),
  }
}

export const laterTask = <T extends { readonly createdAt: Date; readonly id: string }>(
  current: T | null,
  next: T,
): T => {
  if (current === null) return next
  if (next.createdAt > current.createdAt) return next
  if (next.createdAt < current.createdAt) return current
  return next.id > current.id ? next : current
}

export const requesterLabel = (displayName: string, email: string): string => {
  const name = displayName.trim()
  if (name.length > 0) return name
  const at = email.indexOf("@")
  if (at <= 0) return ""
  return email.slice(0, at)
}

export const stringMap = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item
    else if (typeof item === "number" || typeof item === "boolean") result[key] = String(item)
  }
  return result
}

export const proxyHost = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ""
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
  const at = withoutScheme.lastIndexOf("@")
  const hostport = at >= 0 ? withoutScheme.slice(at + 1) : withoutScheme
  const cut = hostport.split(/[/?#]/)[0] ?? ""
  return cut
}

export type ProxyStep = {
  readonly parameters: Readonly<Record<string, string>>
  readonly sources: Readonly<Record<string, string>>
}

export const lastProxyHost = (endpoint: string, steps: readonly ProxyStep[]): string => {
  let host = ""
  let link = ""
  for (const step of steps) {
    for (const [key, source] of Object.entries(step.sources)) {
      const value = step.parameters[key] ?? ""
      if (value.length === 0) continue
      if (source === "proxy.host") host = proxyHost(value)
      if (source === "proxy.link") link = proxyHost(value)
    }
  }
  if (host.length > 0) return host
  if (link.length > 0) return link
  return proxyHost(endpoint)
}

export const publicParameters = (
  parameters: Readonly<Record<string, string>>,
  sources: Readonly<Record<string, string>> = {},
): Record<string, string> => {
  const hidden = new Set<string>()
  for (const [key, source] of Object.entries(sources)) {
    if (HIDDEN_SOURCES.has(source) || HIDDEN_SOURCES.has(key)) hidden.add(key)
  }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parameters)) {
    if (hidden.has(key) || HIDDEN_SOURCES.has(key)) continue
    if (value.toLowerCase().includes("vless://")) continue
    result[key] = value
  }
  return result
}

export type PlanProgressStep = {
  readonly repeat: number
  readonly sequence: number
  readonly stage: number
}

export type ExecutedProgressStep = {
  readonly sequence: number
  readonly status: string
}

export const stepProgress = (
  plan: readonly PlanProgressStep[],
  latestBySegment: ReadonlyMap<string, readonly ExecutedProgressStep[]>,
): { readonly failed: number; readonly finished: number } => {
  let finished = 0
  let failed = 0
  for (const step of plan) {
    const rows = latestBySegment.get(`${step.stage}:${step.repeat}`) ?? []
    const match = rows.find((row) => row.sequence === step.sequence)
    if (match === undefined || !DONE.has(match.status)) continue
    finished += 1
    if (match.status === "failed") failed += 1
  }
  return { failed, finished }
}

export const segmentTitle = (
  stageName: string,
  stagePosition: number,
  repeatIndex: number,
  repeatCount: number,
): string => {
  const name = stageName.length > 0 ? stageName : `第 ${stagePosition + 1} 段`
  const repeat = repeatCount > 1 ? ` 第 ${repeatIndex + 1}/${repeatCount} 次` : ""
  return `${name}${repeat}`
}

export const segmentNote = (autoUsed: number, autoLimit: number, origin: string): string => {
  if (autoUsed > 0) return `已自动重跑 ${autoUsed}/${autoLimit} 次`
  if (origin === "manual") return "已手动重跑"
  return ""
}

export type SegmentPlanStep = {
  readonly fillStatus: string
  readonly parameters: Readonly<Record<string, string>>
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly sequence: number
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
  readonly stageName: string
  readonly stagePosition: number
}

export type SegmentTask = {
  readonly autoLimit: number
  readonly createdAt: Date
  readonly id: string
  readonly repeatIndex: number
  readonly stagePosition: number
}

export type SegmentExecuted = {
  readonly errorCode: string
  readonly parameters: Readonly<Record<string, string>>
  readonly sequence: number
  readonly status: string
  readonly taskId: string
}

export type SegmentReplay = {
  readonly createdAt: Date
  readonly id: string
  readonly origin: string
  readonly repeatIndex: number
  readonly stagePosition: number
}

export type SegmentView = {
  readonly note: string
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly stagePosition: number
  readonly steps: readonly {
    readonly errorCode: string
    readonly parameters: Record<string, string>
    readonly sequence: number
    readonly skill: string
    readonly status: string
  }[]
  readonly title: string
}

export const buildSegments = (input: {
  readonly executed: readonly SegmentExecuted[]
  readonly plan: readonly SegmentPlanStep[]
  readonly replays: readonly SegmentReplay[]
  readonly tasks: readonly SegmentTask[]
}): SegmentView[] => {
  const groups = new Map<string, SegmentPlanStep[]>()
  for (const step of input.plan) {
    const key = `${step.stagePosition}:${step.repeatIndex}`
    const list = groups.get(key) ?? []
    list.push(step)
    groups.set(key, list)
  }
  const keys = [...groups.keys()].sort((left, right) => {
    const [leftStage = "0", leftRepeat = "0"] = left.split(":")
    const [rightStage = "0", rightRepeat = "0"] = right.split(":")
    return Number(leftStage) - Number(rightStage) || Number(leftRepeat) - Number(rightRepeat)
  })
  return keys.flatMap((key) => {
    const list = groups.get(key)
    const head = list?.[0]
    if (list === undefined || head === undefined) return []
    const ordered = [...list].sort((left, right) => left.sequence - right.sequence)
    let latest: SegmentTask | null = null
    for (const task of input.tasks) {
      if (task.stagePosition !== head.stagePosition || task.repeatIndex !== head.repeatIndex) continue
      latest = laterTask(latest, task)
    }
    const chosen = latest
    const executed = chosen === null ? [] : input.executed.filter((row) => row.taskId === chosen.id)
    let newest: SegmentReplay | null = null
    let autoUsed = 0
    for (const replay of input.replays) {
      if (replay.stagePosition !== head.stagePosition || replay.repeatIndex !== head.repeatIndex) {
        continue
      }
      if (replay.origin === "auto") autoUsed += 1
      newest = laterTask(newest, replay)
    }
    return [
      {
        note: segmentNote(autoUsed, chosen?.autoLimit ?? 0, newest?.origin ?? ""),
        repeatCount: head.repeatCount,
        repeatIndex: head.repeatIndex,
        stagePosition: head.stagePosition,
        steps: ordered.map((step) => {
          const hit = executed.find((row) => row.sequence === step.sequence)
          return {
            errorCode: hit?.errorCode ?? "",
            parameters: publicParameters(
              hit === undefined ? step.parameters : hit.parameters,
              step.sources,
            ),
            sequence: step.sequence,
            skill: step.skill,
            status: hit?.status ?? step.fillStatus,
          }
        }),
        title: segmentTitle(head.stageName, head.stagePosition, head.repeatIndex, head.repeatCount),
      },
    ]
  })
}

export type StageAttempt = {
  readonly priority: number
  readonly repeat: number
  readonly stage: number
  readonly status: string
}

export const accountRunStatus = (attempts: readonly StageAttempt[]): string => {
  if (attempts.length === 0) return ""
  const ordered = [...attempts].sort((left, right) => left.stage - right.stage || left.repeat - right.repeat)
  if (ordered.every((item) => item.status === "succeeded")) return "succeeded"
  const current = ordered.find((item) => item.status !== "succeeded")
  if (current === undefined) return "succeeded"
  if (current.status === "failed") return "failed"
  if (current.status === "cancelled") return "cancelled"
  const active =
    current.status === "queued" ||
    current.status === "dispatching" ||
    current.status === "running" ||
    current.status === "ood"
  if (!active) return ""
  if (current.priority === 1) return "replaying"
  if (current.status === "running" || current.status === "ood") return "running"
  return "queued"
}

export const displayRunStatus = (stageStatus: string, failedSteps: number, stepTotal: number): string => {
  if (stageStatus !== "failed") return stageStatus
  if (stepTotal > 0 && failedSteps < stepTotal) return "partial"
  return "failed"
}

export const dispatchRunStatus = (accounts: readonly string[]): string => {
  if (accounts.length === 0 || accounts.every((item) => item.length === 0)) return ""
  if (accounts.some((item) => item === "replaying")) return "replaying"
  if (accounts.some((item) => item === "running")) return "running"
  if (accounts.some((item) => item === "queued")) return "queued"
  const failed = accounts.filter((item) => item === "failed").length
  const partial = accounts.filter((item) => item === "partial").length
  if (failed === accounts.length) return "failed"
  if (failed > 0 || partial > 0) return "partial"
  if (accounts.every((item) => item === "succeeded")) return "succeeded"
  return ""
}

export const runStatusLabel = (status: string): string => {
  if (status === "replaying") return "重跑中"
  if (status === "running") return "执行中"
  if (status === "queued") return "排队中"
  if (status === "partial") return "部分成功"
  if (status === "failed") return "失败"
  if (status === "succeeded") return "成功"
  if (status === "cancelled") return "已取消"
  return ""
}

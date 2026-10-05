export const JOB_STATUS_OPTIONS = [
  { label: "运行中", value: "running" },
  { label: "排队中", value: "queued" },
  { label: "草稿", value: "draft" },
  { label: "成功", value: "success" },
  { label: "已终止", value: "stopped" },
] as const

export type JobStatus = (typeof JOB_STATUS_OPTIONS)[number]["value"]

export type BackgroundJob = {
  createdAt: string
  finishedAt: string
  id: number
  kind: string
  name: string
  progress: number
  startedAt: string
  status: JobStatus
}

export type TaskLog = {
  content: string
  createdAt: string
  feature: string
  id: number
  updatedAt: string
}

export const jobStatusLabel = (value: JobStatus): string =>
  JOB_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

export const jobStatusColor = (value: JobStatus): string => {
  if (value === "success") return "success"
  if (value === "running") return "processing"
  if (value === "queued") return "warning"
  if (value === "stopped") return "default"
  return "default"
}

export const createSeedJobs = (): BackgroundJob[] => []

export const createSeedTaskLogs = (): TaskLog[] => []

export const jobStats = (jobs: readonly BackgroundJob[]) => ({
  draft: jobs.filter((item) => item.status === "draft").length,
  queued: jobs.filter((item) => item.status === "queued").length,
  running: jobs.filter((item) => item.status === "running").length,
  total: jobs.length,
})

export const emptyJob = (id: number): BackgroundJob => ({
  createdAt: "2026-09-17 19:31:00",
  finishedAt: "",
  id,
  kind: "账号状态更新",
  name: "",
  progress: 0,
  startedAt: "",
  status: "draft",
})

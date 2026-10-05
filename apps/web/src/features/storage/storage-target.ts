export const NAS_PROTOCOL_OPTIONS = [
  { label: "SMB", value: "smb" },
  { label: "NFS", value: "nfs" },
  { label: "WebDAV", value: "webdav" },
] as const

export const SQL_ENGINE_OPTIONS = [
  { label: "PostgreSQL", value: "postgresql" },
  { label: "MySQL", value: "mysql" },
  { label: "SQL Server", value: "sqlserver" },
] as const

export const BACKUP_CYCLE_OPTIONS = [
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" },
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

export type StorageKind = "nas" | "sql"
export type NasProtocol = (typeof NAS_PROTOCOL_OPTIONS)[number]["value"]
export type SqlEngine = (typeof SQL_ENGINE_OPTIONS)[number]["value"]
export type BackupCycle = (typeof BACKUP_CYCLE_OPTIONS)[number]["value"]
export type ConnectionStatus = "connected" | "disconnected" | "unknown"
export type BackupStatus = "idle" | "running" | "success" | "failed"
export type BackupMode = "full" | "scheduled"

export type BackupSchedule = {
  cycle: BackupCycle
  enabled: boolean
  time: string
  weekday: number
}

export type BackupState = {
  mode: BackupMode
  percent: number
  status: BackupStatus
}

export type StorageTarget = {
  backup: BackupState
  database: string
  engine: SqlEngine | ""
  host: string
  id: number
  kind: StorageKind
  lastBackupAt: string
  lastTestAt: string
  name: string
  password: string
  port: number
  protocol: NasProtocol | ""
  remark: string
  rootPath: string
  schedule: BackupSchedule
  status: ConnectionStatus
  testFails: boolean
  updateTime: string
  username: string
}

export const BACKUP_STEP = 25

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const defaultPort = (kind: StorageKind, protocol: string, engine: string): number => {
  if (kind === "nas") {
    if (protocol === "nfs") return 2049
    if (protocol === "webdav") return 443
    return 445
  }
  if (engine === "mysql") return 3306
  if (engine === "sqlserver") return 1433
  return 5432
}

export const emptySchedule = (): BackupSchedule => ({
  cycle: "daily",
  enabled: false,
  time: "02:00",
  weekday: 1,
})

export const idleBackup = (): BackupState => ({ mode: "full", percent: 0, status: "idle" })

export const emptyTarget = (kind: StorageKind, id: number, now: string): StorageTarget => ({
  backup: idleBackup(),
  database: kind === "sql" ? "" : "",
  engine: kind === "sql" ? "postgresql" : "",
  host: "",
  id,
  kind,
  lastBackupAt: "",
  lastTestAt: "",
  name: "",
  password: "",
  port: defaultPort(kind, "smb", "postgresql"),
  protocol: kind === "nas" ? "smb" : "",
  remark: "",
  rootPath: kind === "nas" ? "/" : "",
  schedule: emptySchedule(),
  status: "unknown",
  testFails: false,
  updateTime: now,
  username: "",
})

export const protocolLabel = (protocol: string): string =>
  NAS_PROTOCOL_OPTIONS.find((item) => item.value === protocol)?.label ?? protocol

export const engineLabel = (engine: string): string =>
  SQL_ENGINE_OPTIONS.find((item) => item.value === engine)?.label ?? engine

export const connectionLabel = (status: ConnectionStatus): string => {
  if (status === "connected") return "已连接"
  if (status === "disconnected") return "未连接"
  return "未测试"
}

export const connectionColor = (status: ConnectionStatus): string => {
  if (status === "connected") return "success"
  if (status === "disconnected") return "error"
  return "default"
}

export const scheduleLabel = (schedule: BackupSchedule): string => {
  if (!schedule.enabled) return "未启用"
  if (schedule.cycle === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find((item) => item.value === schedule.weekday)?.label ?? ""
    return `每周${weekday} ${schedule.time}`
  }
  return `每天 ${schedule.time}`
}

export const endpointText = (target: StorageTarget): string => {
  if (target.kind === "nas") {
    const protocol = protocolLabel(target.protocol)
    return `${protocol}  ${target.host}:${target.port}  ${target.rootPath}`
  }
  return `${engineLabel(target.engine)}  ${target.host}:${target.port} / ${target.database}`
}

export const validateTarget = (target: StorageTarget): string | null => {
  if (target.name.trim().length === 0) return "请填写名称"
  if (target.host.trim().length === 0) return "请填写主机地址"
  if (target.kind === "nas" && target.rootPath.trim().length === 0) return "请填写根目录"
  if (target.kind === "sql" && target.database.trim().length === 0) return "请填写数据库名"
  if (target.port <= 0) return "请填写端口"
  return null
}

export const testConnection = (target: StorageTarget): { message: string; ok: boolean } => {
  const error = validateTarget(target)
  if (error !== null) return { message: error, ok: false }
  if (target.testFails) return { message: "无法连接到目标，请检查主机、端口和凭据", ok: false }
  return { message: "连接成功", ok: true }
}

export const startBackup = (target: StorageTarget, mode: BackupMode): StorageTarget => ({
  ...target,
  backup: { mode, percent: 8, status: "running" },
})

export const advanceBackup = (target: StorageTarget, now: string): StorageTarget => {
  if (target.backup.status !== "running") return target
  const percent = Math.min(100, target.backup.percent + BACKUP_STEP)
  if (percent >= 100) {
    return {
      ...target,
      backup: { ...target.backup, percent: 100, status: "success" },
      lastBackupAt: now,
    }
  }
  return { ...target, backup: { ...target.backup, percent } }
}

export const filterTargets = (
  targets: readonly StorageTarget[],
  kind: StorageKind,
): StorageTarget[] =>
  targets
    .filter((item) => item.kind === kind)
    .slice()
    .sort((left, right) => right.id - left.id)

export const createSeedTargets = (): StorageTarget[] => []

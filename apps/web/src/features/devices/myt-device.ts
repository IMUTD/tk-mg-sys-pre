export const DEVICE_AUTH_LIMIT = 274
export const DEVICE_MANAGE_PORT = 8099
export const UPGRADE_VERSION_THRESHOLD = 2026063001
export const UPGRADE_SCRIPT_ID = 61
export const CLEAR_SCRIPT_ID = 26

export type DeviceModel = 1 | 2

export type DeviceExtra = {
  readonly cpuload?: string
  readonly cputemp?: number
  readonly hwaddr?: string
  readonly memtotal?: number
  readonly memuse?: number
  readonly mmctotal?: number
  readonly mmcuse?: number
  readonly model?: string
  readonly version?: string
}

export type DeviceLiveStatus = {
  readonly info: DeviceExtra
  readonly ip: string
  readonly pubIp: string
  readonly version: string
}

export type MytDevice = {
  enable: boolean
  expiredTime: string
  extra: DeviceExtra
  id: number
  ip: string
  lastTime: string
  liveIp: string
  liveStatus: DeviceLiveStatus
  model: DeviceModel
  name: string
  overseas: boolean
  remotePort: number | null
  remoteScreenPort: number | null
  remoteUrl: string
  serial: string
  tag: string
  updateTime: string
  userId: string
  version: string
}

export type DeviceFormValues = {
  enable: boolean
  ip: string
  model: DeviceModel
  name: string
  overseas: boolean
  remotePort: string
  remoteScreenPort: string
  remoteUrl: string
  serial: string
  tag: string
}

export type DeviceAuthSlot = {
  readonly extime: string
  readonly slot: string
  readonly state: 0 | 1 | 2
  readonly uid: string
}

export type MockUser = {
  readonly id: string
  readonly name: string
}

export const MOCK_USERS: readonly MockUser[] = [{ id: "1", name: "admin" }]

export const DEVICE_SEQ_OPTIONS: readonly number[] = Array.from(
  { length: 12 },
  (_, index) => index + 1,
)

export const hideMiddle = (value: string): string => {
  if (value.length === 0) return value
  const start = Math.floor(value.length / 3)
  const end = Math.ceil((2 * value.length) / 3)
  return `${value.slice(0, start)}***${value.slice(end)}`
}

const pad2 = (value: number): string => value.toString().padStart(2, "0")

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

export const shortDate = (value: string): string => {
  const date = new Date(value)
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

export const mbToGb = (mb: number | undefined): string | null => {
  if (mb === undefined) return null
  return `${Math.round(mb / 1024)} G`
}

export const getMemoryTotal = (device: MytDevice): string => mbToGb(device.extra.memtotal) ?? "-"

export const getFirmwareVersion = (device: MytDevice): string => device.extra.version ?? "-"

export const getDiskUsed = (device: MytDevice): string => mbToGb(device.extra.mmcuse) ?? "-"

export const getDiskTotal = (device: MytDevice): string => mbToGb(device.extra.mmctotal) ?? "-"

export const calcDiskPercent = (device: MytDevice): number => {
  const used = device.extra.mmcuse
  const total = device.extra.mmctotal
  if (used === undefined || total === undefined || total === 0) return 0
  return Math.round((used / total) * 100)
}

export const getDiskColor = (device: MytDevice): string => {
  const percent = calcDiskPercent(device)
  if (percent >= 90) return "#F56C6C"
  if (percent >= 70) return "#E6A23C"
  return "#67C23A"
}

export const needsFirmwareUpgrade = (device: MytDevice): boolean =>
  Number(device.version) < UPGRADE_VERSION_THRESHOLD

export const isExpired = (value: string): boolean => {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export const remainingDaysLabel = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000)
  return days <= 0 ? "已过期" : `剩余${days}天`
}

export const authStateText = (state: DeviceAuthSlot["state"]): string => {
  if (state === 0) return "正常"
  if (state === 1) return "即将过期"
  return "异常"
}

const trimHost = (value: string): string =>
  value
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "")

export const deviceManageUrl = (device: MytDevice): string => {
  const host = trimHost(device.remoteUrl || device.ip)
  const port = device.remotePort ?? DEVICE_MANAGE_PORT
  return host.length === 0 ? "" : `http://${host}:${port}`
}

export const deviceScreenHost = (device: MytDevice): string =>
  trimHost(device.remoteUrl || device.ip)

export const deviceScreenPort = (device: MytDevice): number =>
  device.remoteScreenPort ?? device.remotePort ?? DEVICE_MANAGE_PORT

export const networkInfoUrl = (device: MytDevice, seq: number): string => {
  const host = deviceScreenHost(device)
  const port = `24${seq.toString().padStart(2, "0")}1`
  return `http://${host}:${port}/ui/#/?hostname=${host}&port=${port}`
}

export const remoteControlUrl = (device: MytDevice, seq: number): string => {
  const host = deviceScreenHost(device)
  const port = deviceScreenPort(device)
  return `http://${host}:${port}/webplayer/play.html?seq=${seq}`
}

export const parsePort = (value: string): number | null => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export const portToFormValue = (value: number | null): string =>
  value === null ? "" : String(value)

export const addDays = (value: string, days: number): string => {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  return `${yyyy}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const tagStatistics = (
  devices: readonly MytDevice[],
): readonly { readonly count: number; readonly tag: string }[] => {
  const counts = new Map<string, number>()
  for (const device of devices) {
    if (device.tag.length === 0) continue
    counts.set(device.tag, (counts.get(device.tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ count, tag }))
    .sort((left, right) => left.tag.localeCompare(right.tag, "zh"))
}

const gb = (value: number): number => value * 1024

const extraOf = (input: {
  readonly diskTotal: number
  readonly diskUsed: number
  readonly firmware: string
  readonly memory: number
}): DeviceExtra => ({
  cpuload: "0.18",
  cputemp: 47,
  hwaddr: "00:e0:4c:68:00:12",
  memtotal: gb(input.memory),
  memuse: gb(6),
  mmctotal: gb(input.diskTotal),
  mmcuse: gb(input.diskUsed),
  model: "MYT-Q1",
  version: input.firmware,
})

const liveOf = (device: {
  readonly extra: DeviceExtra
  readonly ip: string
  readonly liveIp: string
  readonly version: string
}): DeviceLiveStatus => ({
  info: device.extra,
  ip: device.liveIp,
  pubIp: "127.0.0.1",
  version: device.version,
})

const deviceOf = (input: {
  readonly expiredTime: string
  readonly extra: DeviceExtra
  readonly id: number
  readonly ip: string
  readonly lastTime: string
  readonly liveIp?: string
  readonly model?: DeviceModel
  readonly name: string
  readonly overseas?: boolean
  readonly serial: string
  readonly tag: string
  readonly updateTime?: string
  readonly userId?: string
  readonly version: string
}): MytDevice => {
  const extra = input.extra
  const liveIp = input.liveIp ?? input.ip
  const device = {
    enable: true,
    expiredTime: input.expiredTime,
    extra,
    id: input.id,
    ip: input.ip,
    lastTime: input.lastTime,
    liveIp,
    model: input.model ?? 1,
    name: input.name,
    overseas: input.overseas ?? false,
    remotePort: null,
    remoteScreenPort: null,
    remoteUrl: "",
    serial: input.serial,
    tag: input.tag,
    updateTime: input.updateTime ?? input.lastTime,
    userId: input.userId ?? "1",
    version: input.version,
  }
  return { ...device, liveStatus: liveOf(device) }
}

const q1Firmware = "QL-r1q-2026.v0.8.7.202607160651-v3"
const q1FirmwareNew = "QL-r1q-2026.v0.8.9.202609020351-v3"

export const createSeedDevices = (): MytDevice[] => []

export const emptyDeviceForm = (): DeviceFormValues => ({
  enable: true,
  ip: "",
  model: 1,
  name: "",
  overseas: false,
  remotePort: "",
  remoteScreenPort: "",
  remoteUrl: "",
  serial: "",
  tag: "",
})

export const deviceToForm = (device: MytDevice): DeviceFormValues => ({
  enable: device.enable,
  ip: device.ip,
  model: device.model,
  name: device.name,
  overseas: device.overseas,
  remotePort: portToFormValue(device.remotePort),
  remoteScreenPort: portToFormValue(device.remoteScreenPort),
  remoteUrl: device.remoteUrl,
  serial: device.serial,
  tag: device.tag,
})

export const formToDevicePatch = (
  values: DeviceFormValues,
): Omit<
  MytDevice,
  | "id"
  | "extra"
  | "lastTime"
  | "updateTime"
  | "expiredTime"
  | "liveIp"
  | "liveStatus"
  | "userId"
  | "version"
> & {
  readonly remotePort: number | null
  readonly remoteScreenPort: number | null
} => ({
  enable: values.enable,
  ip: values.ip.trim(),
  model: values.model,
  name: values.name.trim(),
  overseas: values.overseas,
  remotePort: parsePort(values.remotePort),
  remoteScreenPort: parsePort(values.remoteScreenPort),
  remoteUrl: values.remoteUrl.trim(),
  serial: values.serial.trim(),
  tag: values.tag.trim(),
})

export const createAuthSlots = (serial: string): DeviceAuthSlot[] =>
  DEVICE_SEQ_OPTIONS.map((seq) => ({
    extime: seq === 12 ? "2026-08-01 00:00:00" : "2027-07-18 16:33:00",
    slot: `${hideMiddle(serial)}-${seq.toString().padStart(2, "0")}`,
    state: seq === 12 ? 2 : seq >= 10 ? 1 : 0,
    uid: seq === 12 ? "-" : "10001",
  }))

export const devicesToCsv = (devices: readonly MytDevice[]): string => {
  const header = ["ID", "序列号", "IP", "分组", "备注", "型号", "版本号", "启用", "过期时间"]
  const rows = devices.map((device) =>
    [
      device.id,
      device.serial,
      device.ip,
      device.tag,
      device.name,
      device.model === 1 ? "Q1" : "P1",
      device.version,
      device.enable ? "启用" : "禁用",
      device.expiredTime,
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  )
  return [header.join(","), ...rows].join("\n")
}

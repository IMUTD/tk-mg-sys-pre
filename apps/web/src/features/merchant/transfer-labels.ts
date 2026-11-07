import type { Key } from "react"

import type { TransferableResource } from "./api"

const STATUS_LABELS: Readonly<Record<string, string>> = {
  disabled: "已停用",
  expired: "已过期",
  hidden: "已隐藏",
  ready: "正常",
  suspended: "已封禁",
  unavailable: "不可用",
  unregistered: "未注册",
}

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status

export const blockLabel = (block: TransferableResource["blockedBy"]): string => {
  switch (block) {
    case "accelerator_linked":
      return "在加速链路里"
    case "has_bindings":
      return "还绑定着账号"
    case "in_use":
      return "正在使用"
    case null:
      return ""
  }
}

/** 翻页后当前页看不到之前选的行，所以按 id 合并，确认时才能列出全部名称。 */
export const mergePicked = (
  keys: readonly Key[],
  picked: readonly TransferableResource[],
  rows: readonly TransferableResource[],
): readonly TransferableResource[] => {
  const known = new Map([...picked, ...rows].map((row) => [row.id, row]))
  return keys.flatMap((key) => known.get(String(key)) ?? [])
}

const MAX_NAMES = 10

export const pickedNames = (picked: readonly TransferableResource[]): string => {
  const names = picked
    .slice(0, MAX_NAMES)
    .map((row) => row.name)
    .join("、")
  return picked.length > MAX_NAMES ? `${names} 等 ${picked.length} 个` : names
}

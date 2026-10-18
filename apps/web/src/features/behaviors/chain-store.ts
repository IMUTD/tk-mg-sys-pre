import { useSyncExternalStore } from "react"

import {
  type BehaviorChain,
  type ChainAnchor,
  type ChainOrigin,
  type ChainStep,
  type GuardCode,
  normalizeDelay,
  type ParamScope,
} from "./rpa-api"

let chains: BehaviorChain[] = []
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) listener()
}

const pad2 = (value: number): string => value.toString().padStart(2, "0")

const textTime = (value: string | null | undefined): string => {
  if (value == null || value.length === 0) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

type ChainPayload = {
  anchor?: ChainAnchor | null
  id: string
  lastTestedAt: string | null
  name: string
  origin: ChainOrigin
  steps: ChainStep[]
  updatedAt: string
}

const toChain = (row: ChainPayload): BehaviorChain => ({
  anchor:
    row.anchor?.table === "operation_account" &&
    (row.anchor.key === "id" || row.anchor.key === "identifier")
      ? { key: row.anchor.key, table: "operation_account" }
      : null,
  id: row.id,
  lastTestAt: textTime(row.lastTestedAt),
  name: row.name,
  origin: row.origin,
  steps: row.steps.map((step, index) => {
    const scopes = Object.fromEntries(
      Object.entries(step.scopes ?? {}).map(([key, value]) => [
        key,
        value === "external" ? "external" : "internal",
      ]),
    ) as Record<string, ParamScope>
    return {
      api: step.api,
      delayMs: normalizeDelay(step.delayMs),
      guards: (step.guards ?? []).filter(
        (code): code is GuardCode => code === "ad" || code === "transcode",
      ),
      id: index,
      params: { ...step.params },
      scopes,
      sources: Object.fromEntries(
        Object.keys(step.params ?? {}).map((key) => [
          key,
          scopes[key] === "external" ? (step.sources?.[key] ?? "") : "literal",
        ]),
      ),
    }
  }),
  updateTime: textTime(row.updatedAt),
})

export const getChains = (): BehaviorChain[] => chains

export const subscribeChains = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useChains = (): BehaviorChain[] => useSyncExternalStore(subscribeChains, getChains)

export const loadChains = async (): Promise<void> => {
  const response = await fetch("/api/behavior-chains", { credentials: "same-origin" })
  if (!response.ok) return
  const rows = (await response.json()) as ChainPayload[]
  if (!Array.isArray(rows)) return
  chains = rows.map(toChain)
  emit()
}

export const saveChain = async (
  origin: ChainOrigin,
  name: string,
  steps: readonly ChainStep[],
  anchor: ChainAnchor | null = null,
): Promise<BehaviorChain> => {
  const response = await fetch("/api/behavior-chains", {
    body: JSON.stringify({
      anchor,
      name: name.trim(),
      origin,
      steps: steps.map((item) => ({
        api: item.api,
        delayMs: item.delayMs ?? 0,
        guards: item.guards ?? [],
        params: item.params,
        scopes: item.scopes,
        sources: item.sources,
      })),
    }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  if (!response.ok) throw new Error("save_failed")
  const row = (await response.json()) as ChainPayload
  const next = toChain(row)
  chains = [next, ...chains.filter((item) => item.id !== next.id)]
  emit()
  return next
}

export const deleteChain = async (id: string): Promise<boolean> => {
  const response = await fetch(`/api/behavior-chains/${id}`, {
    credentials: "same-origin",
    method: "DELETE",
  })
  if (!response.ok) return false
  chains = chains.filter((item) => item.id !== id)
  emit()
  return true
}

export const touchChainTest = (id: string, at: string): void => {
  chains = chains.map((item) =>
    item.id === id ? { ...item, lastTestAt: at, updateTime: at } : item,
  )
  emit()
  void fetch(`/api/behavior-chains/${id}/tested`, {
    credentials: "same-origin",
    method: "POST",
  }).catch(() => undefined)
}

export const resetChains = (): void => {
  chains = []
  emit()
}

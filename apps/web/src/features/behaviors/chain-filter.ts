import { combineChecks, type FilterMode } from "@tk-mg/task-execution/combine-checks"

import { apiLabel, type BehaviorChain, type ChainStep, stepText } from "./rpa-api"

export type BehaviorFilter = {
  readonly account: "" | "bound" | "free"
  readonly apis: readonly string[]
  readonly keyword: string
  readonly mode: FilterMode
  readonly origin: "" | BehaviorChain["origin"]
  readonly remarks: readonly string[]
  readonly tested: "" | "yes" | "no"
}

export type TaskChainFilter = {
  readonly apis: readonly string[]
  readonly chains: readonly string[]
  readonly keyword: string
  readonly mode: FilterMode
  readonly remarks: readonly string[]
}

export type TaskChainFilterItem = {
  readonly name: string
  readonly remarks?: readonly { readonly id: string; readonly name: string }[]
  readonly stages: readonly {
    readonly chainName: string
    readonly steps: readonly ChainStep[]
  }[]
}

const haystack = (parts: readonly string[]): string => parts.join("\n").toLowerCase()

const remarkBits = (remarks: readonly { readonly name: string }[] | undefined): string[] =>
  (remarks ?? []).map((item) => item.name)

const remarkChecks = (
  selected: readonly string[],
  remarks: readonly { readonly id: string }[] | undefined,
): (boolean | null)[] => {
  const names = remarks ?? []
  if (selected.includes("none")) return [names.length === 0]
  return selected.map((id) => names.some((item) => item.id === id))
}

const stepBits = (step: ChainStep): string[] => [
  stepText(step),
  step.remark ?? "",
  apiLabel(step.api),
]

export const matchBehavior = (chain: BehaviorChain, filter: BehaviorFilter): boolean => {
  const keyword = filter.keyword.trim().toLowerCase()
  const keywordHit =
    keyword.length === 0 ||
    haystack([
      chain.name,
      ...remarkBits(chain.remarks),
      ...chain.steps.flatMap(stepBits),
    ]).includes(keyword)
  return (
    keywordHit &&
    combineChecks(filter.mode, [
      filter.origin === "" ? null : chain.origin === filter.origin,
      filter.account === ""
        ? null
        : filter.account === "bound"
          ? chain.anchor !== null
          : chain.anchor === null,
      filter.tested === ""
        ? null
        : filter.tested === "yes"
          ? chain.lastTestAt.length > 0
          : chain.lastTestAt.length === 0,
      ...filter.apis.map((code) => chain.steps.some((step) => step.api === code)),
      ...remarkChecks(filter.remarks, chain.remarks),
    ])
  )
}

export const matchTaskChain = (item: TaskChainFilterItem, filter: TaskChainFilter): boolean => {
  const keyword = filter.keyword.trim().toLowerCase()
  const steps = item.stages.flatMap((stage) => stage.steps)
  const keywordHit =
    keyword.length === 0 ||
    haystack([
      item.name,
      ...remarkBits(item.remarks),
      ...item.stages.map((stage) => stage.chainName),
      ...steps.flatMap(stepBits),
    ]).includes(keyword)
  return (
    keywordHit &&
    combineChecks(filter.mode, [
      ...filter.chains.map((name) => item.stages.some((stage) => stage.chainName === name)),
      ...filter.apis.map((code) => steps.some((step) => step.api === code)),
      ...remarkChecks(filter.remarks, item.remarks),
    ])
  )
}

export const countBy = (values: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

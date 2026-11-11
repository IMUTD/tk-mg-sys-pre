export const foldedScreenSkills = new Set([
  "OcrClick",
  "ClickArrangedNode",
  "ClickNode",
  "Swipe",
  "SwipeNode",
  "WaitNode",
  "SwipeWait",
])

const nodeActions = new Set(["ClickArrangedNode", "ClickNode", "SwipeNode", "WaitNode"])

const fields: Record<string, readonly string[]> = {
  ClickArrangedNode: ["ArrangedIndex"],
  ClickNode: ["Text", "ContentDesc", "ResourceId", "ClassName", "Pkg", "Index"],
  OcrClick: ["OcrText", "OcrIndex"],
  Swipe: ["Direction", "X0", "Y0", "X1", "Y1", "Millis"],
  SwipeNode: [
    "Text",
    "ContentDesc",
    "ResourceId",
    "ClassName",
    "Pkg",
    "MaxCount",
    "Up",
    "Down",
    "Left",
    "Right",
    "RepeatMode",
    "RepeatCount",
    "RepeatMin",
    "RepeatMax",
  ],
  WaitNode: ["Text", "ContentDesc", "ResourceId", "ClassName", "Pkg", "WaitMaxCount"],
  SwipeWait: [
    "SwipeText",
    "SwipeContentDesc",
    "SwipeResourceId",
    "SwipeClassName",
    "SwipePkg",
    "Up",
    "Down",
    "Left",
    "Right",
    "SwipeInterval",
    "Text",
    "ContentDesc",
    "ResourceId",
    "ClassName",
    "Pkg",
    "Index",
  ],
}

const swipeWaitSuffixes = [
  "Action",
  "Pass",
  "SwipeText",
  "SwipeContentDesc",
  "SwipeResourceId",
  "SwipeClassName",
  "SwipePkg",
  "Up",
  "Down",
  "Left",
  "Right",
  "SwipeInterval",
  "Text",
  "ContentDesc",
  "ResourceId",
  "ClassName",
  "Pkg",
  "Index",
] as const

export const orderScreenActKeys = (
  params: Readonly<Record<string, string | undefined>>,
  keys: readonly string[],
): string[] => {
  const ordered: string[] = []
  const placed = new Set<string>()
  for (const phase of ["before", "main", "after"] as const) {
    const own = keys.filter((key) => key.startsWith(phase))
    const action = (params[`${phase}Action`] ?? "").trim()
    if (action === "SwipeWait") {
      for (const suffix of swipeWaitSuffixes) {
        const key = `${phase}${suffix}`
        if (!own.includes(key) || placed.has(key)) continue
        ordered.push(key)
        placed.add(key)
      }
    }
    for (const key of own) {
      if (placed.has(key)) continue
      ordered.push(key)
      placed.add(key)
    }
  }
  for (const key of keys) {
    if (placed.has(key)) continue
    ordered.push(key)
  }
  return ordered
}

export const screenActPhase = (key: string): "before" | "main" | "after" | "" => {
  if (key.startsWith("before")) return "before"
  if (key.startsWith("main")) return "main"
  if (key.startsWith("after")) return "after"
  return ""
}

export const screenActHeading = (
  params: Readonly<Record<string, string | undefined>>,
  key: string,
): string => {
  if (key === "beforeAction") return "事前行为"
  if (key === "mainAction") return "主行为"
  if (key === "afterAction") return "事后行为"
  if (key === "interval") return "时间间隔"
  const phase = screenActPhase(key)
  if (phase.length > 0 && (params[`${phase}Action`] ?? "").trim() === "SwipeWait") {
    if (key === `${phase}SwipeText`) return "滑动"
    if (key === `${phase}Text`) return "出现后通过"
  }
  return ""
}

export const screenActLocked = (key: string): boolean =>
  key === "interval" ||
  /^(before|main|after)(Action|Pass|Focus|Direction|RepeatMode|SwipeInterval)$/.test(key)

export const screenActVisible = (params: Readonly<Record<string, string>>, key: string): boolean => {
  if (key === "interval") return true
  const phase = screenActPhase(key)
  if (phase.length === 0) return true
  const suffix = key.slice(phase.length)
  const action = (params[`${phase}Action`] ?? "").trim()
  if (suffix === "Action") return true
  if (action.length === 0) return false
  if (suffix === "Pass") return true
  if (suffix === "Focus") return nodeActions.has(action)
  if (!(fields[action] ?? []).includes(suffix)) return false
  if (action === "SwipeNode") {
    const random = params[`${phase}RepeatMode`] === "random"
    if (!random && (suffix === "RepeatMin" || suffix === "RepeatMax")) return false
    if (random && suffix === "RepeatCount") return false
  }
  return true
}

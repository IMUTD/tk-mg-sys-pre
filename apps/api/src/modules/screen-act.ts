const phases = ["before", "main", "after"] as const

const actions = new Set([
  "",
  "OcrClick",
  "ClickArrangedNode",
  "ClickNode",
  "Swipe",
  "SwipeNode",
  "WaitNode",
  "SwipeWait",
])

const nodeActions = new Set(["ClickArrangedNode", "ClickNode", "SwipeNode", "WaitNode"])

const focusValues = new Set(["", "left", "right", "above", "below"])

const nodeKeys = ["Text", "ContentDesc", "ResourceId", "ClassName", "Pkg"] as const

const suffixes: readonly { defaultValue: string; label: string; name: string }[] = [
  { name: "Action", label: "行为", defaultValue: "" },
  { name: "Pass", label: "通过", defaultValue: "on" },
  { name: "Focus", label: "关注点", defaultValue: "" },
  { name: "Text", label: "文字", defaultValue: "" },
  { name: "ContentDesc", label: "说明", defaultValue: "" },
  { name: "ResourceId", label: "resource-id", defaultValue: "" },
  { name: "ClassName", label: "类名", defaultValue: "" },
  { name: "Pkg", label: "包名", defaultValue: "" },
  { name: "Index", label: "序号", defaultValue: "0" },
  { name: "MaxCount", label: "最多条数", defaultValue: "20" },
  { name: "Up", label: "上", defaultValue: "0" },
  { name: "Down", label: "下", defaultValue: "0" },
  { name: "Left", label: "左", defaultValue: "0" },
  { name: "Right", label: "右", defaultValue: "0" },
  { name: "RepeatMode", label: "次数", defaultValue: "fixed" },
  { name: "RepeatCount", label: "固定次数", defaultValue: "1" },
  { name: "RepeatMin", label: "最少", defaultValue: "1" },
  { name: "RepeatMax", label: "最多", defaultValue: "3" },
  { name: "WaitMaxCount", label: "最多条数", defaultValue: "20" },
  { name: "ArrangedIndex", label: "序号", defaultValue: "1" },
  { name: "OcrText", label: "文字", defaultValue: "" },
  { name: "OcrIndex", label: "序号", defaultValue: "0" },
  { name: "Direction", label: "方向", defaultValue: "up" },
  { name: "X0", label: "起点 X", defaultValue: "540" },
  { name: "Y0", label: "起点 Y", defaultValue: "1600" },
  { name: "X1", label: "终点 X", defaultValue: "540" },
  { name: "Y1", label: "终点 Y", defaultValue: "900" },
  { name: "Millis", label: "时长", defaultValue: "400" },
  { name: "SwipeText", label: "滑动文字", defaultValue: "" },
  { name: "SwipeContentDesc", label: "滑动说明", defaultValue: "" },
  { name: "SwipeResourceId", label: "滑动 resource-id", defaultValue: "" },
  { name: "SwipeClassName", label: "滑动类名", defaultValue: "" },
  { name: "SwipePkg", label: "滑动包名", defaultValue: "" },
  { name: "SwipeInterval", label: "间隔", defaultValue: "500" },
]

const textOf = (input: Readonly<Record<string, string | undefined>> | null | undefined, key: string): string =>
  (input?.[key] ?? "").trim()

const whole = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

const signed = (raw: string): number | null => {
  if (!/^-?\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

const phaseError = (
  input: Readonly<Record<string, string | undefined>>,
  phase: (typeof phases)[number],
): string | null => {
  const action = textOf(input, `${phase}Action`)
  if (!actions.has(action)) return "行为无效"
  if (action.length === 0) return null
  const pass = textOf(input, `${phase}Pass`)
  if (pass.length > 0 && pass !== "on" && pass !== "off") return "通过无效"
  if (nodeActions.has(action) && !focusValues.has(textOf(input, `${phase}Focus`))) return "关注点无效"
  if (action === "ClickNode" || action === "SwipeNode" || action === "WaitNode") {
    if (nodeKeys.every((name) => textOf(input, `${phase}${name}`).length === 0)) return "条件为空"
  }
  if (action === "ClickNode") {
    const index = textOf(input, `${phase}Index`)
    if (index.length > 0 && whole(index) === null) return "index 无效"
  }
  if (action === "SwipeNode") {
    let distance = 0
    for (const name of ["Up", "Down", "Left", "Right"]) {
      const raw = textOf(input, `${phase}${name}`)
      if (raw.length === 0) continue
      const value = whole(raw)
      if (value === null) return "方向无效"
      distance += value
    }
    if (distance < 1) return "滑动距离无效"
    const mode = textOf(input, `${phase}RepeatMode`)
    if (mode.length === 0 || mode === "fixed") {
      const count = textOf(input, `${phase}RepeatCount`)
      if (count.length > 0) {
        const value = whole(count)
        if (value === null || value < 1 || value > 100) return "次数无效"
      }
    } else if (mode !== "random") {
      return "次数无效"
    } else {
      const low = whole(textOf(input, `${phase}RepeatMin`))
      const high = whole(textOf(input, `${phase}RepeatMax`))
      if (low === null || high === null || low < 1 || high < 1 || low > 100 || high > 100 || low > high) {
        return "次数无效"
      }
    }
  }
  if (action === "ClickArrangedNode") {
    const index = textOf(input, `${phase}ArrangedIndex`)
    if (index.length > 0 && (whole(index) === null || whole(index) === 0)) return "序号无效"
  }
  if (action === "OcrClick") {
    if (textOf(input, `${phase}OcrText`).length === 0) return "文字为空"
    const index = textOf(input, `${phase}OcrIndex`)
    if (index.length > 0 && whole(index) === null) return "index 无效"
  }
  if (action === "Swipe") {
    for (const name of ["X0", "Y0", "X1", "Y1"]) {
      const raw = textOf(input, `${phase}${name}`)
      if (raw.length > 0 && signed(raw) === null) return "滑动坐标无效"
    }
    const millis = textOf(input, `${phase}Millis`)
    if (millis.length > 0) {
      const value = whole(millis)
      if (value === null || value < 1) return "滑动坐标无效"
    }
  }
  if (action === "SwipeWait") {
    if (nodeKeys.every((name) => textOf(input, `${phase}${name}`).length === 0)) return "出现条件为空"
    const swipeNames = ["SwipeText", "SwipeContentDesc", "SwipeResourceId", "SwipeClassName", "SwipePkg"] as const
    if (swipeNames.every((name) => textOf(input, `${phase}${name}`).length === 0)) return "滑动条件为空"
    let distance = 0
    for (const name of ["Up", "Down", "Left", "Right"]) {
      const raw = textOf(input, `${phase}${name}`)
      if (raw.length === 0) continue
      const value = whole(raw)
      if (value === null) return "方向无效"
      distance += value
    }
    if (distance < 1) return "滑动距离无效"
    const index = textOf(input, `${phase}Index`)
    if (index.length > 0 && whole(index) === null) return "index 无效"
    const gap = textOf(input, `${phase}SwipeInterval`)
    if (gap.length > 0) {
      const value = whole(gap)
      if (value === null || value > 60000) return "间隔无效"
    }
  }
  return null
}

export const screenActError = (
  input: Readonly<Record<string, string | undefined>> | null | undefined,
): string | null => {
  const source = input ?? {}
  let selected = false
  for (const phase of phases) {
    if (textOf(source, `${phase}Action`).length === 0) continue
    selected = true
    const problem = phaseError(source, phase)
    if (problem !== null) return problem
  }
  if (!selected) return "屏幕行为为空"
  const interval = textOf(source, "interval")
  if (interval.length > 0) {
    const value = whole(interval)
    if (value === null || value > 60000) return "间隔无效"
  }
  return null
}

export const normalizeScreenAct = (input: Record<string, string>): void => {
  if (textOf(input, "interval").length === 0) input.interval = "500"
  for (const phase of phases) {
    if (textOf(input, `${phase}Pass`).length === 0) input[`${phase}Pass`] = "on"
    if (textOf(input, `${phase}Action`) === "SwipeWait" && textOf(input, `${phase}SwipeInterval`).length === 0) {
      input[`${phase}SwipeInterval`] = "500"
    }
  }
}

export const screenActSkill = {
  batch: true,
  code: "ScreenAct",
  defaults: {
    ...Object.fromEntries(
      phases.flatMap((phase) => suffixes.map((item) => [`${phase}${item.name}`, item.defaultValue])),
    ),
    interval: "500",
  },
  group: "RPA/节点",
  hint: "事前、主行为、事后各选一种画面动作，持续滑动等待也在其中。节点类可选画面关注点。通过开关默认开着，做完一次就算这一段通过。两段之间的间隔默认 500 毫秒。持续滑动等待自己的间隔写在该段里，默认 500。",
  name: "屏幕行为",
  paramLabels: {
    ...Object.fromEntries(
      phases.flatMap((phase) => suffixes.map((item) => [`${phase}${item.name}`, item.label])),
    ),
    interval: "间隔",
  },
  params: [...phases.flatMap((phase) => suffixes.map((item) => `${phase}${item.name}`)), "interval"],
  risk: "write",
} as const

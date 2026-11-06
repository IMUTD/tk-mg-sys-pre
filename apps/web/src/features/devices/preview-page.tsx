import { Button, Card, Checkbox, Input, Modal } from "antd"
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import {
  combineChecks,
  type FilterMode,
  FilterModeSwitch,
} from "../../components/tables/operation-controls"
import { LabelFilterRow, usageLabel } from "../labels/filter-row"
import "./devices.css"

type Slot = {
  readonly height: string
  readonly host: string
  readonly index: number
  readonly label: string
  readonly status: string
  readonly width: string
}

export type BoxRecord = {
  readonly boxGroupId: string | null
  readonly boxGroupName: string | null
  readonly externalId: string
  readonly firmware: string
  readonly host: string
  readonly id: string
  readonly name: string
  readonly remarks: readonly { readonly id: string; readonly name: string }[]
  readonly sequenceNo: number | null
  readonly status: "offline" | "online" | "unknown"
  readonly version: string | null
}

export type LabelItem = {
  readonly id: string
  readonly name: string
}

export type LabelFilter = "all" | "none" | string

export type Pit = {
  readonly boxName: string
  readonly deviceId: string
  readonly height: string
  readonly host: string
  readonly index: number
  readonly label: string
  readonly status: string
  readonly width: string
}

const pitKey = (item: { readonly deviceId: string; readonly index: number }): string =>
  `${item.deviceId}#${item.index}`

const phoneAspect = (pit: Pit): string => {
  const width = Number(pit.width)
  const height = Number(pit.height)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return "9 / 16"
}

const boxLabel = (device: BoxRecord): string =>
  device.name.trim().length > 0 ? device.name : device.host

const readJson = async <T,>(response: Response): Promise<T | null> => {
  if (!response.ok || response.status === 204) return null
  return (await response.json()) as T
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

export const normalizeBoxes = (raw: unknown): BoxRecord[] => {
  if (!Array.isArray(raw)) return []
  const boxes: BoxRecord[] = []
  for (const item of raw) {
    const row = asRecord(item)
    const id = row?.["id"]
    const host = row?.["host"]
    if (row === null || row === undefined || typeof id !== "string" || typeof host !== "string")
      continue
    const remarks = Array.isArray(row["remarks"])
      ? row["remarks"].flatMap((remark) => {
          const entry = asRecord(remark)
          const remarkId = entry?.["id"]
          if (entry === null || entry === undefined || typeof remarkId !== "string") return []
          return [{ id: remarkId, name: textOf(entry["name"]) }]
        })
      : []
    const status = row["status"]
    const sequenceNo = row["sequenceNo"]
    boxes.push({
      boxGroupId: typeof row["boxGroupId"] === "string" ? row["boxGroupId"] : null,
      boxGroupName: typeof row["boxGroupName"] === "string" ? row["boxGroupName"] : null,
      externalId: textOf(row["externalId"]),
      firmware: textOf(row["firmware"]),
      host,
      id,
      name: textOf(row["name"]),
      remarks,
      sequenceNo: typeof sequenceNo === "number" ? sequenceNo : null,
      status: status === "online" || status === "offline" ? status : "unknown",
      version: typeof row["version"] === "string" ? row["version"] : null,
    })
  }
  return boxes
}

export const normalizeLabels = (raw: unknown): { groups: LabelItem[]; remarks: LabelItem[] } => {
  const row = asRecord(raw)
  const read = (key: string): LabelItem[] => {
    const list = row?.[key]
    if (!Array.isArray(list)) return []
    return list.flatMap((item) => {
      const entry = asRecord(item)
      const id = entry?.["id"]
      if (entry === null || entry === undefined || typeof id !== "string") return []
      return [{ id, name: textOf(entry["name"]) }]
    })
  }
  return { groups: read("groups"), remarks: read("remarks") }
}

const matchesLabel = (filter: LabelFilter, id: string | null): boolean => {
  if (filter === "all") return true
  if (filter === "none") return id === null
  return id === filter
}

export const boxMatches = (
  box: BoxRecord,
  filter: {
    readonly filterMode: FilterMode
    readonly groupFilter: LabelFilter
    readonly keyword: string
    readonly presence: "all" | "offline" | "online"
    readonly remarkFilters: readonly string[]
    readonly version: string
  },
): boolean => {
  const text = filter.keyword.trim().toLowerCase()
  const versionText = filter.version.trim().toLowerCase()
  const remarkIds = box.remarks.map((item) => item.id)
  return combineChecks(filter.filterMode, [
    filter.remarkFilters.includes("none") ? remarkIds.length === 0 : null,
    ...(filter.remarkFilters.length > 0 && !filter.remarkFilters.includes("none")
      ? filter.remarkFilters.map((id) => remarkIds.includes(id))
      : []),
    filter.groupFilter === "all" ? null : matchesLabel(filter.groupFilter, box.boxGroupId),
    filter.presence === "all" ? null : box.status === filter.presence,
    versionText.length > 0
      ? `${box.version ?? ""} ${box.firmware}`.toLowerCase().includes(versionText)
      : null,
    text.length === 0
      ? null
      : [
          ...box.remarks.map((item) => item.name),
          box.boxGroupName ?? "",
          box.host,
          box.externalId,
          box.sequenceNo === null ? "" : String(box.sequenceNo),
        ].some((value) => value.toLowerCase().includes(text)),
  ])
}

const loadCatalog = async (): Promise<{
  readonly boxes: BoxRecord[]
  readonly groups: LabelItem[]
  readonly pits: Pit[]
  readonly remarks: LabelItem[]
}> => {
  const [deviceRows, labelRows] = await Promise.all([
    readJson<unknown>(await fetch("/api/devices", { credentials: "same-origin" })),
    readJson<unknown>(await fetch("/api/box-labels", { credentials: "same-origin" })),
  ])
  const boxes = normalizeBoxes(deviceRows)
  const labels = normalizeLabels(labelRows)
  const pitGroups = await Promise.all(
    boxes.map(async (device) => {
      const slots = await readJson<Slot[]>(
        await fetch(`/api/devices/${device.id}/slots`, { credentials: "same-origin" }),
      )
      if (slots === null) return []
      return slots.map((slot) => ({
        boxName: boxLabel(device),
        deviceId: device.id,
        height: slot.height,
        host: slot.host || device.host,
        index: slot.index,
        label: slot.label,
        status: slot.status,
        width: slot.width,
      }))
    }),
  )
  return { boxes, groups: labels.groups, pits: pitGroups.flat(), remarks: labels.remarks }
}

export const DevicePreviewPage = (): ReactNode => {
  const [pits, setPits] = useState<Pit[]>([])
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({})
  const [scale, setScale] = useState(1)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<Pit[]>([])
  const [boxes, setBoxes] = useState<BoxRecord[]>([])
  const [remarks, setRemarks] = useState<LabelItem[]>([])
  const [groups, setGroups] = useState<LabelItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [version, setVersion] = useState("")
  const [presence, setPresence] = useState<"all" | "offline" | "online">("all")
  const [remarkFilters, setRemarkFilters] = useState<readonly string[]>([])
  const [groupFilter, setGroupFilter] = useState<LabelFilter>("all")
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const pitsRef = useRef(pits)
  const previewsRef = useRef(previews)
  pitsRef.current = pits
  previewsRef.current = previews
  const wallKey = pits.map(pitKey).join("|")
  const zoom = (delta: number) => {
    setScale((current) => Math.min(1.6, Math.max(0.5, Math.round((current + delta) * 10) / 10)))
  }

  const showPicker = () => {
    setPicked(new Set())
    setOpen(true)
    setLoading(true)
    void loadCatalog()
      .then((rows) => {
        setBoxes(rows.boxes)
        setRemarks(rows.remarks)
        setGroups(rows.groups)
        setCatalog(rows.pits)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  const resetFilter = () => {
    setKeyword("")
    setVersion("")
    setPresence("all")
    setRemarkFilters([])
    setGroupFilter("all")
    setFilterMode("and")
  }

  const toggleBox = (deviceId: string, on: boolean) => {
    const keys = catalog.filter((item) => item.deviceId === deviceId).map(pitKey)
    setPicked((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const addPicked = () => {
    const chosen = catalog.filter((item) => picked.has(pitKey(item)))
    setPits((current) => {
      const seen = new Set(current.map(pitKey))
      return [...current, ...chosen.filter((item) => !seen.has(pitKey(item)))]
    })
    setOpen(false)
  }

  const removePit = (key: string) => {
    const url = previewsRef.current[key]
    if (url !== undefined) URL.revokeObjectURL(url)
    setPreviews((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setPits((current) => current.filter((item) => pitKey(item) !== key))
  }

  useEffect(() => {
    let stop = false
    let running = false
    const tick = async () => {
      const current = pitsRef.current
      if (running || stop || current.length === 0) return
      running = true
      try {
        const groups = new Map<string, number[]>()
        for (const pit of current) {
          const indexes = groups.get(pit.deviceId) ?? []
          indexes.push(pit.index)
          groups.set(pit.deviceId, indexes)
        }
        await Promise.all(
          [...groups].map(async ([deviceId, indexes]) => {
            await fetch(`/api/devices/${deviceId}/watch`, {
              body: JSON.stringify({ indexNums: indexes }),
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              method: "POST",
            })
            const slots = await readJson<Slot[]>(
              await fetch(`/api/devices/${deviceId}/slots`, { credentials: "same-origin" }),
            )
            if (stop || slots === null) return
            const byIndex = new Map(slots.map((slot) => [slot.index, slot]))
            setPits((existing) =>
              existing.map((pit) => {
                if (pit.deviceId !== deviceId) return pit
                const slot = byIndex.get(pit.index)
                if (slot === undefined) return pit
                return {
                  ...pit,
                  height: slot.height,
                  host: slot.host || pit.host,
                  label: slot.label,
                  status: slot.status,
                  width: slot.width,
                }
              }),
            )
          }),
        )
      } finally {
        running = false
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [wallKey])

  useEffect(() => {
    let stop = false
    let running = false
    const current = new Map<string, string>()
    const tick = async () => {
      const live = pitsRef.current
      if (running || stop || live.length === 0) return
      running = true
      try {
        await Promise.all(
          live.map(async (pit) => {
            const key = pitKey(pit)
            const frame = await fetch(
              `/api/frames?deviceId=${pit.deviceId}&index=${pit.index}`,
              { credentials: "same-origin" },
            )
            if (stop || !frame.ok || frame.status === 204) return
            const blob = await frame.blob()
            if (stop || blob.size === 0) return
            const next = URL.createObjectURL(blob)
            const previous = current.get(key)
            if (previous !== undefined) URL.revokeObjectURL(previous)
            current.set(key, next)
            if (!stop) setPreviews((existing) => ({ ...existing, [key]: next }))
          }),
        )
      } finally {
        running = false
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 1000)
    return () => {
      stop = true
      window.clearInterval(timer)
      for (const url of current.values()) URL.revokeObjectURL(url)
    }
  }, [wallKey])

  const boardStyle: CSSProperties & { readonly "--phone-scale": string } = {
    "--phone-scale": String(scale),
  }
  const filter = { filterMode, groupFilter, keyword, presence, remarkFilters, version }
  const visibleBoxes = useMemo(
    () => boxes.filter((box) => boxMatches(box, filter)),
    [boxes, filterMode, groupFilter, keyword, presence, remarkFilters, version],
  )
  const remarkCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  let unremarkedBoxes = 0
  let ungroupedBoxes = 0
  for (const box of boxes) {
    if (box.remarks.length === 0) unremarkedBoxes += 1
    else for (const item of box.remarks) remarkCounts.set(item.id, (remarkCounts.get(item.id) ?? 0) + 1)
    if (box.boxGroupId === null) ungroupedBoxes += 1
    else groupCounts.set(box.boxGroupId, (groupCounts.get(box.boxGroupId) ?? 0) + 1)
  }
  const visibleGroups = visibleBoxes.map((box) => ({
    box,
    pits: catalog.filter((item) => item.deviceId === box.id),
  }))
  const visiblePitKeys = visibleGroups.flatMap(({ pits: boxPits }) => boxPits.map(pitKey))
  const visibleSelected = visiblePitKeys.filter((key) => picked.has(key)).length
  const toggleVisible = (on: boolean) => {
    setPicked((current) => {
      const next = new Set(current)
      for (const key of visiblePitKeys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  return (
    <section className="control-page">
      <div className="control-toolbar">
        <Button onClick={showPicker} size="small" type="primary">
          添加云机
        </Button>
        <span>画面是盒子代理推上来的截图。可以连续添加，也可以一次勾选多台。</span>
        <Button disabled={scale <= 0.5} onClick={() => zoom(-0.1)} size="small">
          缩小
        </Button>
        <span>{Math.round(scale * 100)}%</span>
        <Button disabled={scale >= 1.6} onClick={() => zoom(0.1)} size="small">
          放大
        </Button>
      </div>
      {pits.length === 0 ? (
        <p className="control-files">还没有云机。点「添加云机」，勾选要看的坑位。</p>
      ) : (
        <div className="control-board" style={boardStyle}>
          {pits.map((pit) => {
            const key = pitKey(pit)
            const cardStyle: CSSProperties & { readonly "--phone-aspect": string } = {
              "--phone-aspect": phoneAspect(pit),
            }
            const name = pit.label.trim().length > 0 ? pit.label : "云机"
            return (
              <article className="control-card" key={key} style={cardStyle}>
                <div className="control-screen">
                  {previews[key] !== undefined ? (
                    <img alt={`${pit.boxName} ${pit.index} 预览`} src={previews[key]} />
                  ) : (
                    <div className="control-empty">等待画面</div>
                  )}
                </div>
                <div className="control-meta">
                  <strong>
                    {pit.boxName} · {pit.index} {name}
                  </strong>
                  <span>{pit.host} · {pit.status}</span>
                  <div className="control-actions">
                    <Button onClick={() => removePit(key)} size="small">
                      移除
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Modal
        className="preview-add"
        confirmLoading={loading}
        okButtonProps={{ disabled: picked.size === 0 }}
        okText={picked.size > 1 ? `添加 ${picked.size} 台` : "添加"}
        onCancel={() => setOpen(false)}
        onOk={addPicked}
        open={open}
        title="添加云机"
        width={960}
      >
        <Card className="condition-panel filter-bar" size="small">
          <LabelFilterRow
            onChange={(values) => {
              const next = values[0]
              setPresence(next === "online" || next === "offline" ? next : "all")
            }}
            options={[
              { label: "在线", value: "online" },
              { label: "离线", value: "offline" },
            ]}
            selected={presence === "all" ? [] : [presence]}
            system
            title="在线状态"
            tone="status"
          />
          <LabelFilterRow
            multiple
            onChange={setRemarkFilters}
            options={remarks.map((item) => ({
              label: usageLabel(item.name, remarkCounts.get(item.id) ?? 0),
              value: item.id,
            }))}
            selected={remarkFilters}
            system
            title="备注"
            unassigned={{ label: usageLabel("未备注", unremarkedBoxes), value: "none" }}
          />
          <LabelFilterRow
            onChange={(values) => setGroupFilter(values[0] ?? "all")}
            options={groups.map((item) => ({
              label: usageLabel(item.name, groupCounts.get(item.id) ?? 0),
              value: item.id,
            }))}
            selected={groupFilter === "all" ? [] : [groupFilter]}
            system
            title="分组"
            unassigned={{ label: usageLabel("未分组", ungroupedBoxes), value: "none" }}
          />
          <div className="condition-search">
            <span className="filter-label">搜索</span>
            <Input
              allowClear
              aria-label="搜索"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="备注 / 分组 / 序列号 / IP"
              style={{ width: 240 }}
              value={keyword}
            />
            <Input
              allowClear
              aria-label="版本号"
              onChange={(event) => setVersion(event.target.value)}
              placeholder="版本号"
              style={{ width: 140 }}
              value={version}
            />
            <Button onClick={resetFilter}>重置</Button>
            <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
          </div>
        </Card>
        {loading ? <p>正在读取盒子上的云机。</p> : null}
        {!loading && catalog.length === 0 ? <p>还没有可预览的云机。</p> : null}
        {!loading && catalog.length > 0 && visibleGroups.length === 0 ? (
          <p className="preview-result-empty">没有符合条件的盒子。</p>
        ) : null}
        {!loading && visibleGroups.length > 0 ? (
          <>
            <div className="preview-result-bar">
              <Checkbox
                checked={visiblePitKeys.length > 0 && visibleSelected === visiblePitKeys.length}
                disabled={visiblePitKeys.length === 0}
                indeterminate={visibleSelected > 0 && visibleSelected < visiblePitKeys.length}
                onChange={(event) => toggleVisible(event.target.checked)}
              >
                全选
              </Checkbox>
              <span className="preview-result-count">
                {visibleGroups.length} 台盒子，{visiblePitKeys.length} 台云机
              </span>
            </div>
            <div className="preview-pits">
              {visibleGroups.map(({ box, pits: boxPits }) => {
                const keys = boxPits.map(pitKey)
                const selectedCount = keys.filter((key) => picked.has(key)).length
                const named = box.name.trim().length > 0
                const statusText =
                  box.status === "online" ? "在线" : box.status === "offline" ? "离线" : "未知"
                return (
                  <div className="preview-box" key={box.id}>
                    <div className="preview-box-head">
                      <Checkbox
                        checked={keys.length > 0 && selectedCount === keys.length}
                        disabled={keys.length === 0}
                        indeterminate={selectedCount > 0 && selectedCount < keys.length}
                        onChange={(event) => toggleBox(box.id, event.target.checked)}
                      >
                        {boxLabel(box)}
                      </Checkbox>
                      <span className="preview-box-meta">
                        {named ? box.host : null}
                        {named ? " · " : null}
                        {statusText}
                        {boxPits.length === 0 ? " · 没有云机" : ` · ${boxPits.length} 台`}
                      </span>
                    </div>
                    {boxPits.length > 0 ? (
                      <div className="preview-box-pits">
                        {boxPits.map((pit) => {
                          const key = pitKey(pit)
                          const name = pit.label.trim().length > 0 ? pit.label : "云机"
                          return (
                            <Checkbox
                              checked={picked.has(key)}
                              key={key}
                              onChange={(event) => {
                                setPicked((current) => {
                                  const next = new Set(current)
                                  if (event.target.checked) next.add(key)
                                  else next.delete(key)
                                  return next
                                })
                              }}
                            >
                              坑位 {pit.index} {name}
                            </Checkbox>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  )
}

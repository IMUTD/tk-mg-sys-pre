import { Button, Card, Checkbox, Input } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { type FilterMode, FilterModeSwitch } from "../../components/tables/operation-controls"
import {
  boxMatches,
  type BoxRecord,
  type LabelFilter,
  type LabelItem,
  normalizeBoxes,
  normalizeLabels,
  type Pit,
} from "../devices/preview-page"
import { LabelFilterRow, usageLabel } from "../labels/filter-row"
import "../devices/devices.css"
import "./tasks.css"

export type CloudInstance = {
  readonly deviceId: string
  readonly index: number
}

type DispatchCloudPickProps = {
  readonly onChange: (value: {
    readonly instances: readonly CloudInstance[]
    readonly pitRange: readonly number[]
  }) => void
}

const pitNumbers = [1, 2, 3, 4, 5]

const pitKey = (item: { readonly deviceId: string; readonly index: number }): string =>
  `${item.deviceId}#${item.index}`

const boxLabel = (device: BoxRecord): string =>
  device.name.trim().length > 0 ? device.name : device.host

const readJson = async <T,>(response: Response): Promise<T | null> => {
  if (!response.ok || response.status === 204) return null
  return (await response.json()) as T
}

export const DispatchCloudPick = ({ onChange }: DispatchCloudPickProps): ReactNode => {
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
  const [pitRange, setPitRange] = useState<number[]>([1, 2, 3, 4, 5])
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stop = false
    void Promise.all([
      fetch("/api/devices", { credentials: "same-origin" }).then((response) => readJson<unknown>(response)),
      fetch("/api/box-labels", { credentials: "same-origin" }).then((response) =>
        readJson<unknown>(response),
      ),
    ])
      .then(async ([deviceRows, labelRows]) => {
        const nextBoxes = normalizeBoxes(deviceRows)
        const labels = normalizeLabels(labelRows)
        const pitGroups = await Promise.all(
          nextBoxes.map(async (device) => {
            const slots = await fetch(`/api/devices/${device.id}/slots?includeEmpty=1`, {
              credentials: "same-origin",
            }).then((response) =>
              readJson<
                {
                  height: string
                  host: string
                  index: number
                  label: string
                  status: string
                  width: string
                }[]
              >(response),
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
        if (stop) return
        setBoxes(nextBoxes)
        setRemarks(labels.remarks)
        setGroups(labels.groups)
        setCatalog(pitGroups.flat())
        setLoading(false)
      })
      .catch(() => {
        if (!stop) setLoading(false)
      })
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    const range = new Set(pitRange)
    const instances = [...picked]
      .map((key) => {
        const split = key.lastIndexOf("#")
        const deviceId = key.slice(0, split)
        const index = Number(key.slice(split + 1))
        return { deviceId, index }
      })
      .filter((item) => range.has(item.index))
    onChange({ instances, pitRange })
  }, [onChange, picked, pitRange])

  const toggleRange = (index: number, on: boolean): void => {
    setPitRange((current) => {
      const next = on ? [...current, index] : current.filter((item) => item !== index)
      return pitNumbers.filter((item) => next.includes(item))
    })
    if (!on) {
      setPicked((current) => {
        const next = new Set(current)
        for (const key of current) if (key.endsWith(`#${index}`)) next.delete(key)
        return next
      })
    }
  }

  const visibleBoxes = boxes.filter((box) =>
    boxMatches(box, { filterMode, groupFilter, keyword, presence, remarkFilters, version }),
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
  const range = new Set(pitRange)
  const visibleGroups = visibleBoxes.map((box) => ({
    box,
    pits: catalog.filter((item) => item.deviceId === box.id && range.has(item.index)),
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
  const toggleBox = (deviceId: string, on: boolean) => {
    const keys = catalog
      .filter((item) => item.deviceId === deviceId && range.has(item.index))
      .map(pitKey)
    setPicked((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  return (
    <div className="dispatch-cloud">
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
          <Button
            onClick={() => {
              setKeyword("")
              setVersion("")
              setPresence("all")
              setRemarkFilters([])
              setGroupFilter("all")
              setFilterMode("and")
            }}
          >
            重置
          </Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div aria-label="坑位范围" className="dispatch-pit-range">
        <span>坑位范围</span>
        {pitNumbers.map((index) => (
          <Checkbox
            checked={pitRange.includes(index)}
            key={index}
            onChange={(event) => toggleRange(index, event.target.checked)}
          >
            {index}
          </Checkbox>
        ))}
      </div>
      {loading ? <p>正在读取盒子上的坑位。</p> : null}
      {!loading && catalog.length === 0 ? <p>还没有可选择的坑位。</p> : null}
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
              {visibleGroups.length} 台盒子，{visiblePitKeys.length} 个坑位
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
                      {boxPits.length === 0 ? " · 没有坑位" : ` · ${boxPits.length} 个坑位`}
                    </span>
                  </div>
                  {boxPits.length > 0 ? (
                    <div className="preview-box-pits">
                      {boxPits.map((pit) => {
                        const key = pitKey(pit)
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
                            坑位 {pit.index}
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
    </div>
  )
}

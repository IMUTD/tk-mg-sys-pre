import { Segmented } from "antd"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { AiStudio } from "./ai-studio"
import { ApiLab } from "./api-lab"
import "./behaviors.css"
import { ChainList } from "./chain-list"
import { loadChains, touchChainTest } from "./chain-store"
import { CloudPanel } from "./cloud-panel"
import {
  type AnchorField,
  type AnchorKey,
  type BehaviorChain,
  type ChainStep,
  type CloudBox,
  type CloudDevice,
  type CloudSlot,
  fallbackAnchorFields,
  fallbackAnchorKeys,
  nowText,
  type SkillSpec,
  setAnchorFields,
  setSkillCatalog,
  type TestResult,
} from "./rpa-api"
import { RpaStudio } from "./rpa-studio"
import { arrangedMarks, type DevicePoint, type ScreenRect } from "./screen-map"
import { TaskChainList } from "./task-chain-list"
import { type LabReport, TestResultCard, taskFinished } from "./test-result"

type BehaviorsPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

type StudioTab = "chains" | "taskChains" | "ai" | "lab"

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const TAB_OPTIONS = [
  { label: "行为链", value: "chains" },
  { label: "任务链", value: "taskChains" },
  { label: "AI制定", value: "ai" },
  { label: "接口测试", value: "lab" },
] as const

const toSlot = (row: {
  height?: number | string | null
  index: number
  label: string
  rpaPort: number
  status: string
  width?: number | string | null
}): CloudSlot => ({
  height: Number(row.height) || 0,
  index: row.index,
  label: row.label,
  rpaPort: row.rpaPort,
  status: row.status,
  width: Number(row.width) || 0,
})

export const BehaviorsPage = ({ canDelete, canWrite }: BehaviorsPageProps): ReactNode => {
  const [tab, setTab] = useState<StudioTab>("chains")
  const [editingChain, setEditingChain] = useState<BehaviorChain | null>(null)
  const [skills, setSkills] = useState<readonly SkillSpec[]>([])
  const [anchorFields, setFields] = useState<readonly AnchorField[]>(fallbackAnchorFields)
  const [anchorKeys, setKeys] = useState<readonly AnchorKey[]>(fallbackAnchorKeys)
  const [boxes, setBoxes] = useState<CloudBox[]>([])
  const [boxId, setBoxId] = useState(0)
  const [slotIndex, setSlotIndex] = useState(1)
  const [logs, setLogs] = useState<TestResult[]>([])
  const [report, setReport] = useState<LabReport | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [nodeMarks, setNodeMarks] = useState<readonly ScreenRect[]>([])
  const [liveMap, setLiveMap] = useState(false)
  const [mapNote, setMapNote] = useState("")
  const requestTicket = useRef(0)
  const liveMapRef = useRef(false)
  const arrangingRef = useRef(false)
  const pendingMapRef = useRef(false)
  const mapTicket = useRef(0)
  const waitingRef = useRef(false)
  const selectedRef = useRef<CloudDevice | null>(null)
  const applyScreen = useRef<(start: DevicePoint, end: DevicePoint) => string | null>(() => null)
  const box = boxes.find((item) => item.id === boxId) ?? null
  const pit = box?.slots.find((item) => item.index === slotIndex) ?? null
  const selected: CloudDevice | null =
    box === null
      ? null
      : {
          deviceId: box.deviceId,
          height: pit?.height ?? 0,
          id: box.id,
          indexNum: slotIndex,
          ip: box.host,
          name: pit?.label || box.name,
          online: box.online,
          rpaPort: pit?.rpaPort ?? 0,
          slot: slotIndex,
          width: pit?.width ?? 0,
        }
  selectedRef.current = selected
  liveMapRef.current = liveMap
  waitingRef.current = waiting

  useEffect(() => {
    let stop = false
    void fetch("/api/skills", { credentials: "same-origin" }).then(async (response) => {
      if (!response.ok || stop) return
      const rows = (await response.json()) as SkillSpec[]
      if (!Array.isArray(rows) || rows.length === 0 || stop) return
      setSkillCatalog(rows)
      setSkills(rows)
    })
    void fetch("/api/behavior-anchors", { credentials: "same-origin" }).then(async (response) => {
      if (!response.ok || stop) return
      const body = (await response.json()) as {
        anchors?: ReadonlyArray<{ fields?: AnchorField[]; keys?: AnchorKey[] }>
      }
      const fields = body.anchors?.[0]?.fields
      const keys = body.anchors?.[0]?.keys?.filter(
        (item) => (item.key === "id" || item.key === "identifier") && item.label.trim().length > 0,
      )
      if (stop) return
      if (Array.isArray(fields) && fields.length > 0) {
        setAnchorFields(fields)
        setFields(fields)
      }
      if (keys !== undefined && keys.length > 0) setKeys(keys)
    })
    const load = async () => {
      const response = await fetch("/api/devices", { credentials: "same-origin" })
      if (!response.ok || stop) return
      const rows = (await response.json()) as ReadonlyArray<{
        externalId: string
        host: string
        id: string
        name: string
        status: string
      }>
      const next: CloudBox[] = []
      for (const [offset, row] of rows.entries()) {
        const slots = await fetch(`/api/devices/${row.id}/slots`, { credentials: "same-origin" })
        const list = slots.ok
          ? ((await slots.json()) as ReadonlyArray<{
              height?: number | string | null
              index: number
              label: string
              rpaPort: number
              status: string
              width?: number | string | null
            }>)
          : []
        next.push({
          deviceId: row.id,
          host: row.host,
          id: offset + 1,
          name: row.name || row.host || row.externalId,
          online: row.status === "online",
          slots: list.map(toSlot),
        })
      }
      if (!stop) {
        setBoxes(next)
        setBoxId((current) => current || next[0]?.id || 0)
        setSlotIndex((current) => {
          if (current >= 1) return current
          const online = next[0]?.slots.find((item) => item.status === "online")
          return online?.index ?? 1
        })
      }
    }
    void load()
    void loadChains()
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (taskId === null) return
    let stop = false
    let timer = 0
    const tick = async (): Promise<void> => {
      const response = await fetch(`/api/tasks/${taskId}`, { credentials: "same-origin" })
      if (stop) return
      if (!response.ok) {
        setWaiting(false)
        return
      }
      const body = (await response.json()) as LabReport
      if (stop) return
      setReport(body)
      if (taskFinished(body.status)) {
        setWaiting(false)
        return
      }
      timer = window.setTimeout(() => {
        void tick()
      }, 1000)
    }
    void tick()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [taskId])

  const stopLiveMap = (): void => {
    liveMapRef.current = false
    mapTicket.current += 1
    pendingMapRef.current = false
    setLiveMap(false)
    setNodeMarks([])
    setMapNote("")
  }

  const pumpMapRef = useRef<() => void>(() => {})
  pumpMapRef.current = (): void => {
    if (!liveMapRef.current) return
    if (arrangingRef.current || waitingRef.current) {
      pendingMapRef.current = true
      return
    }
    const device = selectedRef.current
    if (device === null) {
      setMapNote("请先选择云机")
      return
    }
    arrangingRef.current = true
    pendingMapRef.current = false
    const ticket = mapTicket.current
    setMapNote("正在整理节点")
    void (async () => {
      try {
        const response = await fetch("/api/tasks", {
          body: JSON.stringify({
            deviceId: device.deviceId,
            indexNum: device.indexNum,
            steps: [{ afterMs: 0, guards: [], input: {}, skill: "ArrangeNodes" }],
          }),
          credentials: "same-origin",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          method: "POST",
        })
        const created = (await response.json().catch(() => null)) as { taskId?: string } | null
        if (!response.ok || created?.taskId === undefined || ticket !== mapTicket.current) {
          if (ticket === mapTicket.current && liveMapRef.current) setMapNote("节点整理失败")
          return
        }
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (!liveMapRef.current || ticket !== mapTicket.current) return
          const poll = await fetch(`/api/tasks/${created.taskId}`, { credentials: "same-origin" })
          if (!poll.ok || ticket !== mapTicket.current) {
            if (ticket === mapTicket.current && liveMapRef.current) setMapNote("节点整理失败")
            return
          }
          const body = (await poll.json()) as LabReport
          if (!taskFinished(body.status)) {
            await wait(1000)
            continue
          }
          if (!liveMapRef.current || ticket !== mapTicket.current) return
          if (body.status !== "succeeded") {
            setMapNote("节点整理失败")
            return
          }
          const step = [...body.steps].reverse().find((item) => item.kind === "ArrangeNodes")
          const marks = arrangedMarks(step?.result)
          setNodeMarks(marks)
          setMapNote(marks.length === 0 ? "没有可用坐标" : `已标出 ${marks.length} 个范围`)
          return
        }
        if (ticket === mapTicket.current && liveMapRef.current) setMapNote("节点整理失败")
      } catch {
        if (ticket === mapTicket.current && liveMapRef.current) setMapNote("节点整理失败")
      } finally {
        arrangingRef.current = false
        if (liveMapRef.current && (pendingMapRef.current || ticket !== mapTicket.current)) {
          pendingMapRef.current = false
          pumpMapRef.current()
        }
      }
    })()
  }

  useEffect(() => {
    if (liveMap) pumpMapRef.current()
  }, [liveMap])

  useEffect(() => {
    if (!liveMapRef.current) return
    mapTicket.current += 1
    pendingMapRef.current = true
    if (!arrangingRef.current) pumpMapRef.current()
  }, [selected?.deviceId, selected?.indexNum])

  useEffect(() => {
    if (!waiting && liveMapRef.current) pumpMapRef.current()
  }, [waiting])

  const note = (message: string, ok: boolean): void => {
    setLogs((current) => [...current, { at: nowText(), message, ok }].slice(-20))
  }

  const dispatch = async (
    label: string,
    steps: readonly ChainStep[],
    chainId?: string,
    chainName?: string,
  ): Promise<string | null> => {
    const ticket = requestTicket.current + 1
    requestTicket.current = ticket
    setTaskId(null)
    setWaiting(true)
    setReport({ errorCode: null, name: label, status: "queued", steps: [] })
    if (selected === null) {
      note("请先在右侧选择云机", false)
      setWaiting(false)
      setReport({
        errorCode: null,
        name: label,
        status: "failed",
        steps: [
          {
            errorCode: "请先在右侧选择云机",
            kind: label,
            result: null,
            sequence: 0,
            status: "failed",
          },
        ],
      })
      return null
    }
    try {
      const chain = chainName?.trim() ?? ""
      const response = await fetch("/api/tasks", {
        body: JSON.stringify({
          deviceId: selected.deviceId,
          indexNum: selected.indexNum,
          ...(chain.length > 0 ? { chainName: chain } : {}),
          steps: steps.map((step) => {
            const remark = (step.remark ?? "").trim()
            return {
              afterMs: step.delayMs ?? 0,
              guards: step.guards ?? [],
              input: step.params,
              scopes: step.scopes ?? {},
              skill: step.api,
              sources: step.sources ?? {},
              ...(remark.length > 0 ? { remark } : {}),
            }
          }),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        method: "POST",
      })
      if (ticket !== requestTicket.current) return null
      const body = (await response.json().catch(() => null)) as { error?: string; taskId?: string } | null
      const at = nowText()
      const failure =
        body?.error === "备注过长" ||
          body?.error === "备注无效" ||
          body?.error === "行为链名无效" ||
          body?.error === "没有外部概率" ||
          body?.error === "没有文本池"
          ? body.error
          : "下发失败"
      note(response.ok ? `${label} 已下发` : failure, response.ok)
      if (response.ok && chainId !== undefined) touchChainTest(chainId, at)
      if (!response.ok || body?.taskId === undefined) {
        setWaiting(false)
        setReport({
          errorCode: null,
          name: label,
          status: "failed",
          steps: [
            { errorCode: "下发失败", kind: label, result: null, sequence: 0, status: "failed" },
          ],
        })
        return null
      }
      setTaskId(body.taskId)
      return body.taskId
    } catch {
      if (ticket !== requestTicket.current) return null
      note("下发失败", false)
      setWaiting(false)
      setReport({
        errorCode: null,
        name: label,
        status: "failed",
        steps: [
          { errorCode: "下发失败", kind: label, result: null, sequence: 0, status: "failed" },
        ],
      })
      return null
    }
  }

  const clearShared = (): void => {
    requestTicket.current += 1
    setLogs([])
    setReport(null)
    setTaskId(null)
    setWaiting(false)
  }

  const runTest = (
    name: string,
    steps: readonly ChainStep[],
    chainId?: string,
    chainName?: string,
  ): boolean => {
    void dispatch(name, steps, chainId, chainName)
    return selected !== null
  }

  return (
    <section className="module-page behaviors-page">
      <div className="behaviors-layout">
        <div className="behaviors-workspace">
          <Segmented
            onChange={(value) => {
              setEditingChain(null)
              setTab(value as StudioTab)
            }}
            options={[...TAB_OPTIONS]}
            value={tab}
          />
          {tab === "chains" && editingChain === null ? (
            <ChainList
              canWrite={canWrite}
              {...(canDelete === undefined ? {} : { canDelete })}
              onEdit={setEditingChain}
              onTest={runTest}
            />
          ) : null}
          {tab === "chains" && editingChain !== null ? (
            <RpaStudio
              key={editingChain.id}
              anchorFields={anchorFields}
              anchorKeys={anchorKeys}
              applyScreen={applyScreen}
              canWrite={canWrite}
              loadedChain={editingChain}
              mapped={nodeMarks.length > 0}
              onBack={() => setEditingChain(null)}
              onClearMap={stopLiveMap}
              onMapNodes={() => {
                const step = [...(report?.steps ?? [])].reverse().find((item) => item.kind === "ArrangeNodes")
                const marks = arrangedMarks(step?.result)
                if (marks.length === 0) return "先测试节点整理，拿到坐标后再映射"
                setNodeMarks(marks)
                return `已在画面标出 ${marks.length} 个范围`
              }}
              onSaved={setEditingChain}
              onTest={runTest}
              skills={skills}
            />
          ) : null}
          {tab === "taskChains" ? (
            <TaskChainList canWrite={canWrite} {...(canDelete === undefined ? {} : { canDelete })} />
          ) : null}
          {tab === "ai" ? <AiStudio canWrite={canWrite} onTest={runTest} /> : null}
          {tab === "lab" ? (
            <ApiLab
              applyScreen={applyScreen}
              onEnqueue={(name, steps) => dispatch(name, steps)}
              pending={waiting}
              skills={skills}
            />
          ) : null}
        </div>
        <CloudPanel
          boxId={boxId}
          boxes={boxes}
          mapNote={mapNote}
          mapping={liveMap}
          marks={nodeMarks}
          onFrame={() => pumpMapRef.current()}
          onToggleMap={() => {
            if (liveMapRef.current) {
              stopLiveMap()
              return
            }
            setLiveMap(true)
          }}
          onGesture={(start, end) => {
            const message = applyScreen.current(start, end)
            if (message === null) return
            setLogs((current) => [...current, { at: nowText(), message, ok: true }].slice(-20))
          }}
          onSelectBox={setBoxId}
          onSelectSlot={setSlotIndex}
          selected={selected}
          slotIndex={slotIndex}
        />
      </div>
      <TestResultCard logs={logs} onClear={clearShared} report={report} waiting={waiting} />
    </section>
  )
}

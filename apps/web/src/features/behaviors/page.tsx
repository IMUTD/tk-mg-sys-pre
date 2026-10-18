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
import type { DevicePoint } from "./screen-map"
import { type LabReport, TestResultCard, taskFinished } from "./test-result"

type BehaviorsPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

type StudioTab = "chains" | "ai" | "rpa" | "lab"

const TAB_OPTIONS = [
  { label: "行为链", value: "chains" },
  { label: "AI制定", value: "ai" },
  { label: "RPA编排", value: "rpa" },
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
  const requestTicket = useRef(0)
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

  const note = (message: string, ok: boolean): void => {
    setLogs((current) => [...current, { at: nowText(), message, ok }].slice(-20))
  }

  const dispatch = async (
    label: string,
    steps: readonly ChainStep[],
    chainId?: string,
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
      const response = await fetch("/api/tasks", {
        body: JSON.stringify({
          deviceId: selected.deviceId,
          indexNum: selected.indexNum,
          steps: steps.map((step) => ({
            afterMs: step.delayMs ?? 0,
            guards: step.guards ?? [],
            input: step.params,
            skill: step.api,
          })),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        method: "POST",
      })
      if (ticket !== requestTicket.current) return null
      const body = (await response.json().catch(() => null)) as { taskId?: string } | null
      const at = nowText()
      note(response.ok ? `${label} 已下发` : "下发失败", response.ok)
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

  const runTest = (name: string, steps: readonly ChainStep[], chainId?: string): boolean => {
    void dispatch(name, steps, chainId)
    return selected !== null
  }

  return (
    <section className="module-page behaviors-page">
      <div className="behaviors-layout">
        <div className="behaviors-workspace">
          <Segmented
            onChange={(value) => setTab(value as StudioTab)}
            options={[...TAB_OPTIONS]}
            value={tab}
          />
          {tab === "chains" ? (
            <ChainList {...(canDelete === undefined ? {} : { canDelete })} onTest={runTest} />
          ) : null}
          {tab === "ai" ? <AiStudio canWrite={canWrite} onTest={runTest} /> : null}
          {tab === "rpa" ? (
            <RpaStudio
              anchorFields={anchorFields}
              anchorKeys={anchorKeys}
              applyScreen={applyScreen}
              canWrite={canWrite}
              onTest={runTest}
              skills={skills}
            />
          ) : null}
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

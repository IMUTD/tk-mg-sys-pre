import { Button, Card } from "antd"
import { type ReactNode } from "react"

import type { TestResult } from "./rpa-api"

export type LabStep = {
  errorCode: string | null
  kind: string
  result: unknown
  sequence: number
  status: string
}

export type LabReport = {
  errorCode: string | null
  name: string
  status: string
  steps: LabStep[]
}

const STATUS_TEXT: Record<string, string> = {
  cancelled: "已取消",
  claimed: "已领取",
  dispatching: "派发中",
  failed: "失败",
  held: "守护中",
  ood: "守护中",
  pending: "等待",
  queued: "排队中",
  running: "执行中",
  succeeded: "成功",
}

export const taskFinished = (status: string): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled"

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return { text: value }
    }
  }
  return {}
}

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return JSON.stringify(value, null, 2)
}

const isXml = (key: string, value: string): boolean => {
  const text = value.trimStart()
  return key.toLowerCase() === "xml" || text.startsWith("<?xml") || text.startsWith("<hierarchy") || text.startsWith("<node")
}

const ResultValue = ({ name, value }: { readonly name: string; readonly value: string }): ReactNode => {
  if (value.startsWith("data:image/")) return <img alt={name} className="api-lab-image" src={value} />
  if (isXml(name, value)) {
    return (
      <details className="api-lab-xml">
        <summary>XML · {value.length} 字符，点击展开</summary>
        <pre>{value}</pre>
      </details>
    )
  }
  return <pre className="api-lab-text">{value}</pre>
}

const orderedEntries = (result: unknown): Array<[string, string]> => {
  const entries = Object.entries(asRecord(result)).map(([key, value]) => [key, textOf(value)] as [string, string])
  const image = entries.filter(([, value]) => value.startsWith("data:image/"))
  const xml = entries.filter(([key, value]) => isXml(key, value))
  const rest = entries.filter(([key, value]) => !value.startsWith("data:image/") && !isXml(key, value))
  return [...image, ...rest, ...xml]
}

type TestResultCardProps = {
  readonly logs: readonly TestResult[]
  readonly onClear: () => void
  readonly report: LabReport | null
  readonly waiting: boolean
}

export const TestResultCard = ({ logs, onClear, report, waiting }: TestResultCardProps): ReactNode => {
  const hasLogs = logs.length > 0
  return (
    <Card
      className="behaviors-result"
      extra={hasLogs || report !== null ? <Button onClick={onClear} size="small" type="link">清空记录</Button> : null}
      size="small"
      title="测试返回"
    >
      {report === null ? (
        <p className="behaviors-meta">点击测试后，云机返回的内容会显示在这里。四个页签共用这一份记录。</p>
      ) : (
        <div className="api-lab-report">
          <p>
            {report.name ? `${report.name} · ` : ""}
            {STATUS_TEXT[report.status] ?? report.status}
            {waiting ? "，正在接收返回" : ""}
          </p>
          {report.steps.length === 0 ? <p className="behaviors-meta">等待云机返回。</p> : null}
          {report.steps.map((step) => (
            <section key={`${step.sequence}-${step.kind}`}>
              <h3>
                {step.kind || "步骤"} · {STATUS_TEXT[step.status] ?? step.status}
                {step.errorCode ? ` · ${step.errorCode}` : ""}
              </h3>
              {orderedEntries(step.result).map(([key, value]) => (
                <div className="api-lab-field" key={key}>
                  <span>{key}</span>
                  <ResultValue name={key} value={value} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      {hasLogs ? (
        <pre className="cloud-log">
          {logs
            .slice()
            .reverse()
            .map((item) => `[${item.at}] ${item.ok ? "成功" : "失败"} ${item.message}`)
            .join("\n")}
        </pre>
      ) : null}
    </Card>
  )
}

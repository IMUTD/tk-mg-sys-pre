import { Button, Card } from "antd"
import { type ReactNode, useMemo } from "react"

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
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
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
  return (
    key.toLowerCase() === "xml" ||
    text.startsWith("<?xml") ||
    text.startsWith("<hierarchy") ||
    text.startsWith("<node")
  )
}

const FLAG_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["clickable", "true", "可点"],
  ["focused", "true", "已聚焦"],
  ["selected", "true", "已选中"],
  ["checked", "true", "已勾选"],
  ["enabled", "false", "不可用"],
  ["scrollable", "true", "可滚动"],
]

type NodeView = {
  bounds: string
  children: NodeView[]
  className: string
  desc: string
  flags: string[]
  hidden: boolean
  id: string
  path: string
  text: string
}

const clip = (value: string): string => (value.length > 60 ? `${value.slice(0, 60)}…` : value)

const shortClass = (className: string): string => {
  const dot = className.lastIndexOf(".")
  return dot >= 0 ? className.slice(dot + 1) : className
}

const readNode = (el: Element, path: string): NodeView => {
  const bounds = el.getAttribute("bounds") ?? ""
  const flags: string[] = []
  for (const [attr, expect, label] of FLAG_LABELS) {
    if (el.getAttribute(attr) === expect) flags.push(label)
  }
  const children = Array.from(el.children)
    .filter((child) => child.tagName.toLowerCase() === "node")
    .map((child, index) => readNode(child, `${path}.${index}`))
  return {
    bounds,
    children,
    className: el.getAttribute("class") ?? "",
    desc: el.getAttribute("content-desc") ?? "",
    flags,
    hidden: bounds === "[0,0][0,0]",
    id: el.getAttribute("resource-id") ?? "",
    path,
    text: el.getAttribute("text") ?? "",
  }
}

const nodeCount = (node: NodeView): number =>
  1 + node.children.reduce((sum, child) => sum + nodeCount(child), 0)

const parseHierarchy = (xml: string): { count: number; roots: NodeView[] } | null => {
  const doc = new DOMParser().parseFromString(xml, "text/xml")
  if (doc.querySelector("parsererror") !== null) return null
  const root = doc.documentElement
  if (root === null) return null
  const source =
    root.tagName.toLowerCase() === "node"
      ? [root]
      : Array.from(root.children).filter((child) => child.tagName.toLowerCase() === "node")
  if (source.length === 0) return null
  const roots = source.map((el, index) => readNode(el, String(index)))
  return { count: roots.reduce((sum, node) => sum + nodeCount(node), 0), roots }
}

const NodeLine = ({ depth, node }: { readonly depth: number; readonly node: NodeView }): ReactNode => {
  const named = node.text.length > 0 || node.desc.length > 0 || node.id.length > 0
  const classLabel = named ? shortClass(node.className) : node.className
  return (
    <>
      <div
        className={node.hidden ? "api-lab-node is-hidden" : "api-lab-node"}
        style={{ paddingLeft: depth * 16 }}
      >
        <b title={node.className}>{classLabel}</b>
        {node.text.length > 0 ? <span title={node.text}> 文字={clip(node.text)}</span> : null}
        {node.desc.length > 0 ? <span title={node.desc}> 说明={clip(node.desc)}</span> : null}
        {node.id.length > 0 ? <span> resource-id={node.id}</span> : null}
        {node.bounds.length > 0 ? <span> {node.bounds}</span> : null}
        {node.flags.map((flag) => (
          <span key={flag}> {flag}</span>
        ))}
        {node.hidden ? <span> 看不见</span> : null}
      </div>
      {node.children.map((child) => (
        <NodeLine depth={depth + 1} key={child.path} node={child} />
      ))}
    </>
  )
}

const NodeTree = ({ xml }: { readonly xml: string }): ReactNode => {
  const parsed = useMemo(() => parseHierarchy(xml), [xml])
  if (parsed === null) {
    return (
      <details className="api-lab-xml">
        <summary>XML · {xml.length} 字符，点击展开</summary>
        <pre>{xml}</pre>
      </details>
    )
  }
  return (
    <div className="api-lab-nodes">
      <p className="behaviors-meta">共 {parsed.count} 个节点。范围是 [0,0][0,0] 的当前看不见。</p>
      {parsed.roots.map((node) => (
        <NodeLine depth={0} key={node.path} node={node} />
      ))}
      <details className="api-lab-xml">
        <summary>原始 XML · {xml.length} 字符</summary>
        <pre>{xml}</pre>
      </details>
    </div>
  )
}

const arrangedLine = (index: string, bounds: string): string => `${index}  ${bounds}`

const arrangedNodeLines = (value: string): string | null => {
  const text = value.trim()
  if (!text.startsWith("[")) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return null
    const lines: string[] = []
    for (const item of parsed) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return null
      const row = item as Record<string, unknown>
      if (typeof row["index"] !== "number" || typeof row["bounds"] !== "string") return null
      lines.push(arrangedLine(String(row["index"]), row["bounds"]))
    }
    return lines.length === 0 ? "没有可用坐标" : lines.join("\n")
  } catch {
    const found = [...text.matchAll(/\{(\d+)\s+(\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\])\}/g)]
    if (found.length === 0) return null
    return found.map((item) => arrangedLine(item[1] ?? "", item[2] ?? "")).join("\n")
  }
}

const ResultValue = ({
  name,
  value,
}: {
  readonly name: string
  readonly value: string
}): ReactNode => {
  if (value.startsWith("data:image/"))
    return <img alt={name} className="api-lab-image" src={value} />
  if (isXml(name, value)) return <NodeTree xml={value} />
  const arranged = arrangedNodeLines(value)
  if (arranged !== null) return <pre className="api-lab-text">{arranged}</pre>
  return <pre className="api-lab-text">{value}</pre>
}

const orderedEntries = (result: unknown): Array<[string, string]> => {
  const entries = Object.entries(asRecord(result)).map(
    ([key, value]) => [key, textOf(value)] as [string, string],
  )
  const image = entries.filter(([, value]) => value.startsWith("data:image/"))
  const xml = entries.filter(([key, value]) => isXml(key, value))
  const rest = entries.filter(
    ([key, value]) => !value.startsWith("data:image/") && !isXml(key, value),
  )
  return [...image, ...rest, ...xml]
}

type TestResultCardProps = {
  readonly logs: readonly TestResult[]
  readonly onClear: () => void
  readonly report: LabReport | null
  readonly waiting: boolean
}

export const TestResultCard = ({
  logs,
  onClear,
  report,
  waiting,
}: TestResultCardProps): ReactNode => {
  const hasLogs = logs.length > 0
  return (
    <Card
      className="behaviors-result"
      extra={
        hasLogs || report !== null ? (
          <Button onClick={onClear} size="small" type="link">
            清空记录
          </Button>
        ) : null
      }
      size="small"
      title="测试返回"
    >
      {report === null ? (
        <p className="behaviors-meta">
          点击测试后，云机返回的内容会显示在这里。这些页签共用这一份记录。
        </p>
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

import { useQuery } from "@tanstack/react-query"
import { Button, Card, Input, Space } from "antd"
import { type ReactNode, useState } from "react"

import { DataTable, type TableColumn } from "../../components/tables/data-table"
import { type AuditApi, type AuditEvent, type AuditFilter, createAuditApi } from "./api"
import "./work-logs.css"

const groupIdFromMetadata = (metadata: Readonly<Record<string, string>>): string => {
  const value = Object.getOwnPropertyDescriptor(metadata, "groupId")?.value
  return typeof value === "string" ? value : "—"
}

const columns: readonly TableColumn<AuditEvent>[] = [
  { cell: (event) => event.createdAt.toLocaleString("zh-CN"), header: "时间", id: "createdAt" },
  { cell: (event) => event.actorId, header: "操作者", id: "actor" },
  { cell: (event) => event.action, header: "操作", id: "action" },
  { cell: (event) => event.target, header: "目标", id: "target" },
  {
    cell: (event) => groupIdFromMetadata(event.metadata),
    header: "分组",
    id: "group",
  },
  { cell: (event) => event.outcome, header: "结果", id: "outcome" },
] as const

type AuditPageProps = { readonly api?: AuditApi }

const emptyFilter: AuditFilter = { page: 1, pageSize: 20 }

export const AuditPage = ({ api: suppliedApi }: AuditPageProps): ReactNode => {
  const api = suppliedApi ?? createAuditApi()
  const [draft, setDraft] = useState(emptyFilter)
  const [filter, setFilter] = useState(emptyFilter)
  const events = useQuery({ queryFn: () => api.list(filter), queryKey: ["audit", filter] })
  const page = events.data ?? { items: [], page: filter.page, pageSize: filter.pageSize, total: 0 }
  const changePage = (nextPage: number): void => setFilter({ ...filter, page: nextPage })
  return (
    <section className="module-page work-logs-page">
      <Card className="filter-bar" size="small">
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">操作</span>
          <Input
            allowClear
            aria-label="操作筛选"
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            placeholder="操作"
            style={{ width: 185 }}
            value={draft.action ?? ""}
          />
          <span className="filter-label">操作者</span>
          <Input
            allowClear
            aria-label="操作者筛选"
            onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            placeholder="操作者 UUID"
            style={{ width: 200 }}
            value={draft.actorId ?? ""}
          />
          <span className="filter-label">分组</span>
          <Input
            allowClear
            aria-label="分组筛选"
            onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
            placeholder="分组 UUID"
            style={{ width: 200 }}
            value={draft.groupId ?? ""}
          />
          <span className="filter-label">目标</span>
          <Input
            allowClear
            aria-label="目标筛选"
            onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            placeholder="目标"
            style={{ width: 185 }}
            value={draft.target ?? ""}
          />
          <Button onClick={() => setFilter({ ...draft, page: 1 })} type="primary">
            查询
          </Button>
        </Space>
        <div className="work-log-time-filters">
          <div className="work-log-time-row">
            <span className="filter-label">开始时间</span>
            <Input
              aria-label="开始时间"
              onChange={(event) => setDraft({ ...draft, createdAfter: event.target.value })}
              type="datetime-local"
              value={draft.createdAfter ?? ""}
            />
          </div>
          <div className="work-log-time-row">
            <span className="filter-label">结束时间</span>
            <Input
              aria-label="结束时间"
              onChange={(event) => setDraft({ ...draft, createdBefore: event.target.value })}
              type="datetime-local"
              value={draft.createdBefore ?? ""}
            />
          </div>
        </div>
      </Card>
      <DataTable
        columns={columns}
        emptyMessage="暂无工作日志"
        onPageChange={changePage}
        page={page}
      />
    </section>
  )
}

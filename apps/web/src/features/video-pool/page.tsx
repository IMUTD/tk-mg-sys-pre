import { App, Button, Card, Input, Space, Table, type TableColumnsType } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"

import {
  createSeedVideos,
  emptyVideoQuery,
  filterVideos,
  type VideoQuery,
  type VideoWork,
} from "./catalog"
import "../mall/mall.css"
import { LabelFilterRow, UNASSIGNED_VALUE } from "../labels/filter-row"

const columns: TableColumnsType<VideoWork> = [
  { dataIndex: "uid", title: "UID/作品ID", width: 140 },
  {
    dataIndex: "cover",
    render: () => <div className="video-cover">封面</div>,
    title: "封面",
    width: 80,
  },
  {
    dataIndex: "caption",
    render: (value: string) => <span className="video-caption">{value}</span>,
    title: "文案",
  },
  { dataIndex: "views", title: "播放量", width: 90 },
  { dataIndex: "likes", title: "点赞量", width: 90 },
  { dataIndex: "comments", title: "评论量", width: 90 },
  { dataIndex: "group", title: "账号分组", width: 140 },
  { dataIndex: "publishedAt", title: "发布时间", width: 120 },
  { dataIndex: "updatedAt", title: "更新时间", width: 170 },
]

type VideoPoolPageProps = {
  readonly canDelete?: boolean
}

export const VideoPoolPage = ({ canDelete = false }: VideoPoolPageProps): ReactNode => {
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<VideoQuery>(emptyVideoQuery)
  const [query, setQuery] = useState<VideoQuery>(emptyVideoQuery)
  const [videos, setVideos] = useState(createSeedVideos)
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const rows = filterVideos(videos, query)
  const videoSelection = useFilteredRowSelection({
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    rowKey: "id",
    rows,
    selectedKeys: selectedIds,
  })
  const groups = useMemo(
    () => [...new Set(videos.map((item) => item.group))].map((value) => ({ label: value, value })),
    [videos],
  )

  const deleteSelected = (): void => {
    if (selectedIds.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selectedIds.length} 条视频吗？`,
      okText: "确定",
      onOk: () => {
        const idSet = new Set(selectedIds)
        setVideos((current) => current.filter((item) => !idSet.has(item.id)))
        setSelectedIds([])
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  return (
    <section className="module-page video-pool-page">
      <Card size="small">
        <LabelFilterRow
          title="账号分组"
          options={groups.filter((item) => item.value.trim().length > 0)}
          selected={draft.ungrouped ? [UNASSIGNED_VALUE] : draft.group === "" ? [] : [draft.group]}
          unassigned={{ value: UNASSIGNED_VALUE, label: "未分组" }}
          onChange={(groups) => {
            const value = groups[0] ?? ""
            const next =
              value === UNASSIGNED_VALUE
                ? { ...draft, group: "", ungrouped: true }
                : { ...draft, group: value, ungrouped: false }
            setDraft(next)
            setQuery(next)
          }}
        />
        <Space wrap>
          <Input
            allowClear
            aria-label="作品id"
            onChange={(event) =>
              setDraft((current) => ({ ...current, workId: event.target.value }))
            }
            placeholder="作品id"
            style={{ width: 160 }}
            value={draft.workId}
          />
          <Input
            allowClear
            aria-label="文案"
            onChange={(event) =>
              setDraft((current) => ({ ...current, caption: event.target.value }))
            }
            placeholder="文案"
            style={{ width: 200 }}
            value={draft.caption}
          />
          <Button
            onClick={() => {
              setQuery(draft)
            }}
            type="primary"
          >
            搜索
          </Button>
          <Button
            onClick={() => {
              const empty = emptyVideoQuery()
              setDraft(empty)
              setQuery(empty)
            }}
          >
            重置
          </Button>
          {canDelete ? (
            <Button danger disabled={selectedIds.length === 0} onClick={deleteSelected}>
              删除
            </Button>
          ) : null}
          <Button onClick={() => message.success("导出成功")}>导出</Button>
          <Button
            disabled={selectedIds.length === 0}
            onClick={() => message.success("导出选中成功")}
          >
            导出选中
          </Button>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowKey="id"
        rowSelection={videoSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </section>
  )
}

import type { TableColumnsType } from "antd"
import { App, Button, InputNumber, Modal, Progress, Space, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import { useClientPagination } from "../../components/tables/operation-controls"
import { formatRemarks } from "../labels/remark-list"

import {
  type MytTaskRes,
  type PoolAccount,
  type PoolProgress,
  poolAccountsToCsv,
  progressPercent,
  statusLabel,
  unusedAccountsToCsv,
} from "./myt-task-res"

const STATS_NOTICE =
  "统计结果仅供参考，可能受平台延迟、网络波动及账号状态变化影响，请以平台实际数据为准。"

const downloadCsv = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

type HelpDialogProps = {
  readonly onClose: () => void
}

export const HelpDialog = ({ onClose }: HelpDialogProps): ReactNode => (
  <Modal footer={null} onCancel={onClose} open title="什么是账号池?" width={640}>
    <div className="pool-help">
      <h4>1. 简单介绍</h4>
      <p>
        账号池是一个集中管理的账号集合，旨在优化任务执行系统中的账号使用效率。通过将多个分组的账号汇集在一起，系统可以在执行任务时灵活调用这些账号，确保任务的顺利进行，并在任务中断时能够快速重发，避免重复执行。
      </p>
      <h4>2. 为什么这么设计</h4>
      <p>
        <strong>资源浪费</strong>
        ：传统模式下，账号常常被单独管理，导致很多账号在某些时间段内处于闲置状态。账号池通过集中管理，最大化利用每个账号的使用率。
      </p>
      <p>
        <strong>任务中断处理</strong>
        ：在任务执行过程中，如果出现中断，传统模式需要手动处理账号的重新分配，增加了人工干预的复杂性。账号池能够自动从中提取账号，简化流程。
      </p>
      <p>
        <strong>效率提升</strong>
        ：通过快速响应和动态分配账号，账号池能够减少任务的等待时间，提高整体执行效率。
      </p>
      <h4>3. 对比传统模式直接下发的优势</h4>
      <p>
        <strong>灵活性</strong>
        ：账号池允许动态分配和调整账号，传统模式则通常需要固定账号，缺乏灵活性。
      </p>
      <p>
        <strong>管理便捷</strong>
        ：账号池集中管理多个账号，减少了对每个账号的单独操作，提高了管理的便捷性。
      </p>
      <p>
        <strong>负载均衡</strong>
        ：账号池可以实现任务负载的均衡分配，避免了某些账号过载而其他账号闲置的情况，传统模式则难以实现有效的负载均衡。
      </p>
    </div>
  </Modal>
)

type StatsDialogProps = {
  readonly onClose: () => void
  readonly pool: MytTaskRes
  readonly variant: "main" | "beta"
}

export const StatsDialog = ({ onClose, pool, variant }: StatsDialogProps): ReactNode => {
  const { message } = App.useApp()
  const statsPaging = useClientPagination(String(pool.accounts.length))
  const banned = pool.accounts.filter((item) => item.status === "1").length
  const playTotal = pool.accounts.reduce((sum, item) => sum + item.playTotal, 0)
  const columns: TableColumnsType<PoolAccount> = [
    { dataIndex: "uid", ellipsis: true, key: "uid", title: "UID", width: 180 },
    { dataIndex: "username", ellipsis: true, key: "username", title: "用户名", width: 140 },
    { dataIndex: "tag", key: "tag", title: "分组", width: 90 },
    {
      key: "status",
      render: (_value: unknown, item: PoolAccount) => statusLabel(item.status as "0" | "1"),
      title: "状态",
      width: 80,
    },
    { dataIndex: "follower", key: "follower", title: "粉丝", width: 80 },
    { dataIndex: "following", key: "following", title: "关注", width: 80 },
    { dataIndex: "playToday", key: "playToday", title: "今日", width: 80 },
    { dataIndex: "playYesterday", key: "playYesterday", title: "昨日", width: 80 },
    { dataIndex: "playBeforeYesterday", key: "playBeforeYesterday", title: "前日", width: 80 },
    { dataIndex: "playTotal", key: "playTotal", title: "播放总量", width: 90 },
    {
      key: "queryStatus",
      render: (_value: unknown, item: PoolAccount) => (
        <Tag color={item.statisticsState === "stored" ? "success" : "default"}>
          {item.statisticsState === "stored" ? "已存数据" : "未查询"}
        </Tag>
      ),
      title: "查询状态",
      width: 90,
    },
    {
      dataIndex: "remark",
      ellipsis: true,
      key: "remark",
      render: (remark: string) => formatRemarks(remark),
      title: "备注",
    },
  ]

  return (
    <Modal
      footer={null}
      onCancel={onClose}
      open
      title={variant === "beta" ? "统计(备用)" : "数据统计"}
      width={1100}
    >
      <p className="stats-notice">{STATS_NOTICE}</p>
      {variant === "beta" ? (
        <p className="stats-notice">
          此方案不限制查询次数，但需要使用内置动态流量包。每次查询大约消耗50KB流量。
        </p>
      ) : null}
      <Space className="stats-summary" wrap>
        <span>总数 {pool.accounts.length}</span>
        <span>封号 {banned}</span>
        <span>播放总量 {playTotal}</span>
        <Button
          onClick={() => {
            downloadCsv(poolAccountsToCsv(pool.accounts), `${pool.key}-统计.csv`)
            message.success("导出成功")
          }}
        >
          导出({pool.accounts.length})
        </Button>
      </Space>
      <Table
        columns={columns}
        dataSource={[...pool.accounts]}
        pagination={{ ...statsPaging.pagination, total: pool.accounts.length }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}

type ProgressDialogProps = {
  readonly onClose: () => void
  readonly pool: MytTaskRes
}

export const ProgressDialog = ({ onClose, pool }: ProgressDialogProps): ReactNode => {
  const { message } = App.useApp()
  const columns: TableColumnsType<PoolProgress> = [
    { dataIndex: "key", key: "key", title: "分组" },
    {
      key: "remain",
      render: (_value: unknown, item: PoolProgress) => `${item.size} / ${item.total}`,
      title: "剩余 / 总数",
      width: 120,
    },
    {
      key: "percent",
      render: (_value: unknown, item: PoolProgress) => (
        <Progress percent={progressPercent(item)} size="small" />
      ),
      title: "消耗进度",
    },
    {
      key: "export",
      render: (_value: unknown, item: PoolProgress) => (
        <Button
          onClick={() => {
            const accounts = pool.accounts.filter(
              (account) =>
                account.recordId !== undefined && item.unusedAccountIds?.includes(account.recordId),
            )
            downloadCsv(poolAccountsToCsv(accounts), `${item.key}-未使用.csv`)
            message.success("导出成功")
          }}
        >
          导出未使用
        </Button>
      ),
      title: "操作",
      width: 130,
    },
  ]

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button
            onClick={() => {
              downloadCsv(unusedAccountsToCsv(pool), `${pool.key}-未使用.csv`)
              message.success("导出成功")
            }}
          >
            导出未使用
          </Button>
        </div>
      }
      onCancel={onClose}
      open
      title="消耗进度"
      width={640}
    >
      <Table
        columns={columns}
        dataSource={[...pool.progress]}
        pagination={false}
        rowKey="key"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}

type AccountListDialogProps = {
  readonly onClose: () => void
  readonly pool: MytTaskRes
}

export const AccountListDialog = ({ onClose, pool }: AccountListDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [minPlay, setMinPlay] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const accountPaging = useClientPagination(`${pool.id}:${minPlay ?? ""}`)
  const filtered = useMemo(
    () =>
      minPlay === null
        ? [...pool.accounts]
        : pool.accounts.filter((item) => item.playTotal < minPlay),
    [minPlay, pool.accounts],
  )
  const accountSelection = useFilteredRowSelection({
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    rowKey: "id",
    rows: filtered,
    selectedKeys: selectedIds,
  })
  const lowPlay = pool.accounts.filter((item) => item.playTotal < (minPlay ?? 0))
  const columns: TableColumnsType<PoolAccount> = [
    { dataIndex: "uid", ellipsis: true, key: "uid", title: "UID", width: 180 },
    { dataIndex: "username", ellipsis: true, key: "username", title: "用户名", width: 140 },
    { dataIndex: "tag", key: "tag", title: "分组", width: 90 },
    {
      key: "status",
      render: (_value: unknown, item: PoolAccount) => statusLabel(item.status as "0" | "1"),
      title: "状态",
      width: 80,
    },
    {
      key: "online",
      render: (_value: unknown, item: PoolAccount) => (
        <Tag color={item.online ? "success" : "error"}>{item.online ? "在线" : "离线"}</Tag>
      ),
      title: "在线",
      width: 80,
    },
    { dataIndex: "follower", key: "follower", title: "粉丝", width: 80 },
    { dataIndex: "playTotal", key: "playTotal", title: "播放总量", width: 90 },
    {
      key: "plays",
      render: (_value: unknown, item: PoolAccount) => item.videoPlays.join(", "),
      title: "播放量",
      width: 140,
    },
    {
      dataIndex: "proxyRemark",
      key: "proxyRemark",
      render: (remark: string) => formatRemarks(remark),
      title: "代理",
      width: 90,
    },
    {
      dataIndex: "remark",
      ellipsis: true,
      key: "remark",
      render: (remark: string) => formatRemarks(remark),
      title: "备注",
    },
  ]

  return (
    <Modal footer={null} onCancel={onClose} open title="账号列表" width={1100}>
      <Space className="stats-summary" wrap>
        <span>最低播放量</span>
        <InputNumber
          aria-label="最低播放量"
          min={0}
          onChange={(value) => setMinPlay(value)}
          placeholder="最低播放量"
          value={minPlay}
        />
        <Button onClick={() => setSelectedIds(lowPlay.map((item) => item.id))}>
          全选低播放量账号({lowPlay.length})
        </Button>
        <Button
          onClick={() => {
            downloadCsv(poolAccountsToCsv(filtered), `${pool.key}-账号列表.csv`)
            message.success("导出成功")
          }}
        >
          导出({filtered.length})
        </Button>
      </Space>
      <Table
        columns={columns}
        dataSource={filtered}
        pagination={{ ...accountPaging.pagination, total: filtered.length }}
        rowKey="id"
        rowSelection={accountSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}

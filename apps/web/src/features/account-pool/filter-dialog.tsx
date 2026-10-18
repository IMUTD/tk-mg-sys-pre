import type { TableColumnsType } from "antd"
import { App, Button, Input, Modal, Popover, Select, Space, Table } from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import { PageKey } from "../../lib/pages"
import { createAccountsApi, type OperationAccount } from "../accounts/api"
import {
  APP_OPTIONS,
  BACK_TYPE_OPTIONS,
  QUICK_FILTER_OPTIONS,
  STATUS_OPTIONS,
  statusLabel,
} from "../accounts/myt-account"
import { createDevicesApi } from "../devices/api"
import { BusinessLabelFilter, LabelFilterRow, UNASSIGNED_VALUE } from "../labels/filter-row"
import { formatRemarks } from "../labels/remark-list"
import { createProxiesApi } from "../proxies/api"
import type { DeskPoolQuery } from "./api"
import {
  type DeskAccountPreview,
  deskPoolKey,
  emptyDeskQuery,
  matchesDeskQuery,
  normalizeDeskQuery,
  proxyEndpoint,
  resolveDeskPoolName,
  toDeskPreview,
} from "./desk-pool"

const previewColumns: TableColumnsType<DeskAccountPreview> = [
  { dataIndex: "username", ellipsis: true, key: "username", title: "用户名", width: 180 },
  { dataIndex: "uid", ellipsis: true, key: "uid", title: "UID", width: 140 },
  { dataIndex: "tag", ellipsis: true, key: "tag", title: "账号分组", width: 110 },
  {
    ellipsis: true,
    key: "tagBucket",
    render: (_value: unknown, account: DeskAccountPreview) =>
      account.tagBucket.length === 0 ? "-" : account.tagBucket.join("、"),
    title: "账号标签",
    width: 140,
  },
  {
    key: "status",
    render: (_value: unknown, account: DeskAccountPreview) => statusLabel(account.status),
    title: "状态",
    width: 80,
  },
  { dataIndex: "follower", key: "follower", title: "粉丝", width: 70 },
  { dataIndex: "following", key: "following", title: "关注", width: 70 },
  { dataIndex: "region", ellipsis: true, key: "region", title: "归属地", width: 90 },
  {
    dataIndex: "remark",
    ellipsis: true,
    key: "remark",
    render: (remark: string) => {
      const text = formatRemarks(remark)
      return text.length === 0 ? "-" : text
    },
    title: "用户备注",
  },
]

type FilterDialogProps = {
  readonly groupId: string
  readonly onCancel: () => void
  readonly onSubmit: (query: DeskPoolQuery, name: string) => Promise<void>
}

export const PoolFilterDialog = ({ groupId, onCancel, onSubmit }: FilterDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [query, setQuery] = useState<DeskPoolQuery>(emptyDeskQuery)
  const [customName, setCustomName] = useState("")
  const [devices, setDevices] = useState<readonly { id: string; label: string }[]>([])
  const [proxies, setProxies] = useState<readonly { id: string; label: string }[]>([])
  const [regions, setRegions] = useState<readonly string[]>([])
  const [accounts, setAccounts] = useState<readonly DeskAccountPreview[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [saving, setSaving] = useState(false)
  const normalized = normalizeDeskQuery(query)
  const deviceLabel = devices.find((item) => item.id === normalized.deviceId)?.label ?? ""
  const proxyLabel = proxies.find((item) => item.id === normalized.proxyId)?.label ?? ""
  const name = resolveDeskPoolName(
    deskPoolKey(normalized, { device: deviceLabel, proxy: proxyLabel }),
    customName,
  )
  const matched = useMemo(
    () => accounts.filter((account) => matchesDeskQuery(account, normalized)),
    [accounts, normalized],
  )

  useEffect(() => {
    let stop = false
    void createDevicesApi()
      .list(groupId)
      .then((items) => {
        if (!stop)
          setDevices(items.map((item) => ({ id: item.id, label: `${item.name} - ${item.host}` })))
      })
      .catch(() => undefined)
    void createProxiesApi()
      .list([groupId])
      .then((items) => {
        if (stop) return
        setProxies(
          items.flatMap((item) =>
            item.uuid === undefined
              ? []
              : [{ id: item.uuid, label: proxyEndpoint(item.ip, item.port) }],
          ),
        )
      })
      .catch(() => undefined)
    void (async () => {
      const api = createAccountsApi()
      const records: OperationAccount[] = []
      for (let page = 1; page <= 20; page += 1) {
        const result = await api.list({ deleted: false, groupId, page, pageSize: 500 })
        records.push(...result.items)
        if (result.items.length === 0 || page * result.pageSize >= result.total) break
      }
      const transfers = await api.listTransfers(groupId).catch(() => [])
      const codes = new Map<string, string[]>()
      for (const row of transfers) {
        for (const id of row.accountIds) codes.set(id, [...(codes.get(id) ?? []), row.code])
      }
      const previews = records
        .filter((item) => !item.deleted)
        .map((item) => toDeskPreview(item, codes.get(item.id) ?? []))
      const found = new Set(
        previews.flatMap((item) => (item.region.trim().length === 0 ? [] : [item.region.trim()])),
      )
      if (stop) return
      setAccounts(previews)
      setRegions([...found].sort((left, right) => left.localeCompare(right, "zh-CN")))
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!stop) setLoadingAccounts(false)
      })
    return () => {
      stop = true
    }
  }, [groupId])

  const change = (patch: Partial<DeskPoolQuery>): void => {
    setQuery((current) => ({ ...current, ...patch }))
  }

  const submit = async (): Promise<void> => {
    if (saving || name.length === 0) return
    if (name.includes("+") || name.length > 400) {
      message.error("命名不能包含 + ，并且不能超过 400 字")
      return
    }
    setSaving(true)
    try {
      await onSubmit(normalized, name)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            disabled={name.length === 0}
            loading={saving}
            onClick={() => void submit()}
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增账号池"
      width={1080}
    >
      <BusinessLabelFilter
        blankLabel="未分组"
        onChange={(tag) =>
          change(
            tag === UNASSIGNED_VALUE ? { tag: "", ungrouped: true } : { tag, ungrouped: false },
          )
        }
        page={PageKey.Accounts}
        system
        title="账号分组"
        value={query.ungrouped ? UNASSIGNED_VALUE : query.tag}
      />
      <BusinessLabelFilter
        blankLabel="未标签"
        multiple
        onChange={(tagBucket) =>
          change(
            tagBucket.includes(UNASSIGNED_VALUE)
              ? { tagBucket: [], untagged: true }
              : { tagBucket: [...tagBucket], untagged: false },
          )
        }
        page={PageKey.Accounts}
        scope="account-tag"
        system
        title="账号标签"
        value={query.untagged ? [UNASSIGNED_VALUE] : query.tagBucket}
      />
      <BusinessLabelFilter
        blankLabel="未备注"
        kind="remark"
        multiple
        onChange={(userRemarks) =>
          change(
            userRemarks.includes(UNASSIGNED_VALUE)
              ? { userRemark: "", userRemarks: [], unremarked: true }
              : { userRemark: "", userRemarks, unremarked: false },
          )
        }
        page={PageKey.Accounts}
        scope="account"
        system
        title="用户备注"
        value={
          query.unremarked
            ? [UNASSIGNED_VALUE]
            : query.userRemarks.length > 0
              ? query.userRemarks
              : query.userRemark.length > 0
                ? [query.userRemark]
                : []
        }
      />
      <LabelFilterRow
        onChange={(values) => change({ status: values[0] ?? "" })}
        options={STATUS_OPTIONS.filter((option) => option.value !== "4").map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        selected={query.status.length === 0 ? [] : [query.status]}
        system
        title="账号状态"
      />
      <LabelFilterRow
        onChange={(values) => change({ app: values[0] ?? "" })}
        options={APP_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
        selected={query.app.length === 0 ? [] : [query.app]}
        system
        title="APP类型"
      />
      <LabelFilterRow
        onChange={(values) => change({ backType: values[0] ?? "" })}
        options={BACK_TYPE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
        selected={query.backType.length === 0 ? [] : [query.backType]}
        system
        title="备份方式"
      />
      <LabelFilterRow
        multiple
        onChange={(quick) => change({ quick })}
        options={QUICK_FILTER_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        selected={query.quick}
        system
        title="快捷筛选"
      />
      <LabelFilterRow
        multiple
        onChange={(region) => change({ region })}
        options={regions.map((region) => ({ label: region, value: region }))}
        selected={query.region}
        system
        title="归属地"
      />
      <Space className="resource-filter-row" wrap>
        <span className="filter-label">绑定设备：</span>
        <Select
          allowClear
          aria-label="绑定设备"
          onChange={(value) => change({ deviceId: typeof value === "string" ? value : null })}
          options={devices.map((item) => ({ label: item.label, value: item.id }))}
          placeholder="绑定设备"
          showSearch
          style={{ width: 220 }}
          value={query.deviceId}
        />
        <span className="filter-label">绑定代理：</span>
        <Select
          allowClear
          aria-label="绑定代理"
          onChange={(value) => change({ proxyId: typeof value === "string" ? value : null })}
          options={proxies.map((item) => ({ label: item.label, value: item.id }))}
          placeholder="绑定代理"
          showSearch
          style={{ width: 220 }}
          value={query.proxyId}
        />
        <Popover
          content={
            <Input.TextArea
              aria-label="用户名 / UID 内容"
              autoSize={{ minRows: 6, maxRows: 12 }}
              onChange={(event) => change({ identity: event.target.value })}
              placeholder="用户名或 UID，可用逗号、分号、空格或换行分隔"
              style={{ width: 360 }}
              value={query.identity}
            />
          }
          placement="bottomLeft"
          trigger="click"
        >
          <Input
            aria-label="用户名 / UID"
            placeholder="用户名 / UID"
            readOnly
            style={{ width: 180, cursor: "pointer" }}
            value={query.identity}
          />
        </Popover>
        <Input
          allowClear
          aria-label="最少粉丝数"
          onChange={(event) => change({ followerGT: event.target.value.replace(/\D/g, "") })}
          placeholder="最少粉丝数"
          style={{ width: 120 }}
          value={query.followerGT}
        />
        <Input
          allowClear
          aria-label="最少关注数"
          onChange={(event) => change({ followingGT: event.target.value.replace(/\D/g, "") })}
          placeholder="最少关注数"
          style={{ width: 120 }}
          value={query.followingGT}
        />
        <Input
          allowClear
          aria-label="转移码"
          onChange={(event) => change({ transferKey: event.target.value })}
          placeholder="转移码"
          style={{ width: 160 }}
          value={query.transferKey}
        />
      </Space>
      <Space className="resource-filter-row" wrap>
        <span className="filter-label">命名</span>
        <Input
          allowClear
          aria-label="命名"
          maxLength={400}
          onChange={(event) => setCustomName(event.target.value)}
          placeholder="留空则自动命名"
          style={{ width: 360 }}
          value={customName}
        />
      </Space>
      <p className="muted">{name}</p>
      <p>账号信息（{matched.length}）</p>
      <Table<DeskAccountPreview>
        columns={previewColumns}
        dataSource={[...matched]}
        loading={loadingAccounts}
        locale={{ emptyText: "没有符合条件的账号" }}
        pagination={{ pageSize: 8, showTotal: (total) => `共 ${total} 条`, size: "small" }}
        rowKey="id"
        scroll={{ x: "max-content", y: 240 }}
        size="small"
      />
    </Modal>
  )
}

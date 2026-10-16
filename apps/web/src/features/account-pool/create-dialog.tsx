import type { TableColumnsType } from "antd"
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
} from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { FilteredSelectCheckbox } from "../../components/tables/filtered-selection"
import { PageKey } from "../../lib/pages"
import { type MytAccount, STATUS_OPTIONS } from "../accounts/myt-account"
import { BusinessLabelFilter } from "../labels/filter-row"
import { formatRemarks } from "../labels/remark-list"
import { type AccountPoolsApi, type PoolWrite, poolRequestError } from "./api"
import {
  CREATE_BACK_TYPE_OPTIONS,
  type CreatePoolQuery,
  canJoinPool,
  DEVICE_SEQ_OPTIONS,
  emptyCreatePoolQuery,
  needsDevice,
  needsSeq,
  shortDate,
  statusLabel,
  uniqueTagBuckets,
} from "./myt-task-res"
import { type PoolDeskDevice, sourceAccount, sourceFilter, usePoolSources } from "./wiring"

type CreatePoolDialogProps = {
  readonly devices: readonly PoolDeskDevice[]
  readonly api: AccountPoolsApi
  readonly groupId: string
  readonly onCancel: () => void
  readonly onSubmit: (pool: PoolWrite) => Promise<void>
}

const CREATE_LIMIT = 3000

export const CreatePoolDialog = ({
  devices,
  api,
  groupId,
  onCancel,
  onSubmit,
}: CreatePoolDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [query, setQuery] = useState<CreatePoolQuery>(emptyCreatePoolQuery)
  const [remark, setRemark] = useState("")
  const [times, setTimes] = useState(1)
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [saving, setSaving] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [selectionCoversFilter, setSelectionCoversFilter] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const source = usePoolSources(groupId, api, query, devices, pageSize)
  const tagOptions = source.groups
  const bucketOptions = useMemo(() => uniqueTagBuckets(source.items), [source.items])
  const queryKey = JSON.stringify(query)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed filter invalidates the selected account UUIDs.
  useEffect(() => {
    setSelectedIds([])
    setSelectionCoversFilter(false)
  }, [queryKey])

  const selectAllSources = async (): Promise<void> => {
    setSelectingAll(true)
    try {
      const filter = sourceFilter(query, devices)
      const ids: string[] = []
      let pageNo = 1
      let totalCount = 0
      do {
        const result = await api.sources(groupId, filter, pageNo, 500)
        result.items.forEach((item, index) => {
          const account = sourceAccount(item, index, devices)
          if (canJoinPool(account)) ids.push(account.recordId ?? String(account.id))
        })
        totalCount = result.total
        pageNo += 1
        if (result.items.length === 0) break
      } while ((pageNo - 1) * 500 < totalCount && pageNo <= 20)
      setSelectedIds([...new Set(ids)].slice(0, CREATE_LIMIT))
      setSelectionCoversFilter(true)
    } catch (error) {
      message.error(await poolRequestError(error))
    } finally {
      setSelectingAll(false)
    }
  }

  const changeBackType = (value: string): void => {
    setQuery({
      ...emptyCreatePoolQuery(),
      backType: value,
    })
    setSelectedIds([])
  }

  const refreshTags = (): void => {
    if (needsDevice(query.backType) && query.deviceId === null) {
      message.error("请选择设备")
      return
    }
    source.refresh()
  }

  const create = async (type: 1 | 2): Promise<void> => {
    if (saving) return
    if (needsDevice(query.backType) && query.deviceId === null) {
      message.error("请选择设备")
      return
    }
    if (type === 1 && source.total === 0) {
      message.warning("没有可新建的账号")
      return
    }
    if (type === 2 && selectedIds.length === 0) {
      message.warning("请选择要新建的账号")
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        filter: sourceFilter(
          { ...query, deviceSeq: needsSeq(query.backType) ? query.deviceSeq : null },
          devices,
        ),
        mode: type === 1 ? "all" : "selected",
        ...(type === 2 ? { accountIds: selectedIds } : {}),
        remark,
        times,
      })
    } catch (error) {
      message.error(await poolRequestError(error))
    } finally {
      setSaving(false)
    }
  }

  const columns: TableColumnsType<MytAccount> = [
    { dataIndex: "uid", ellipsis: true, key: "uid", title: "UID", width: 180 },
    { dataIndex: "tag", key: "tag", title: "账号分组", width: 100 },
    {
      key: "tagBucket",
      render: (_value: unknown, item: MytAccount) =>
        item.tagBucket.map((tag) => (
          <Tag color="success" key={tag}>
            {tag}
          </Tag>
        )),
      title: "标签组",
      width: 160,
    },
    {
      key: "status",
      render: (_value: unknown, item: MytAccount) => statusLabel(item.status),
      title: "状态",
      width: 80,
    },
    {
      key: "online",
      render: (_value: unknown, item: MytAccount) => (
        <Tag color={item.online ? "success" : "error"}>{item.online ? "在线" : "离线"}</Tag>
      ),
      title: "在线状态",
      width: 90,
    },
    {
      key: "transfer",
      render: (_value: unknown, item: MytAccount) => (
        <Tag color={canJoinPool(item) ? "default" : "error"}>
          {canJoinPool(item) ? "未转移" : "已转移不可加入"}
        </Tag>
      ),
      title: "转移状态",
      width: 140,
    },
    {
      dataIndex: "remark",
      ellipsis: true,
      key: "remark",
      render: (remark: string) => formatRemarks(remark),
      title: "备注",
    },
    {
      key: "updateTime",
      render: (_value: unknown, item: MytAccount) => shortDate(item.updateTime),
      title: "更新时间",
      width: 120,
    },
  ]

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button
            disabled={source.loading || source.error}
            loading={saving}
            onClick={() => void create(1)}
          >
            新建所有({source.total > CREATE_LIMIT ? "最多3000" : source.total})
          </Button>
          <Button
            disabled={source.loading || source.error}
            loading={saving}
            onClick={() => void create(2)}
            type="primary"
          >
            新建选中({selectedIds.length})
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="创建账号池"
      width={1400}
    >
      <div className="pool-create-layout">
        <Form
          className="pool-create-form"
          labelCol={{ style: { width: 80 } }}
          layout="horizontal"
          size="small"
        >
          <Form.Item label="备份类型">
            <Radio.Group
              onChange={(event) => changeBackType(event.target.value)}
              optionType="button"
              options={[...CREATE_BACK_TYPE_OPTIONS]}
              size="small"
              value={query.backType}
            />
          </Form.Item>
          {needsDevice(query.backType) ? (
            <Form.Item label="设备" required>
              <Select
                aria-label="创建设备"
                onChange={(value: number) => {
                  setQuery({ ...query, deviceId: value, tag: [] })
                  setSelectedIds([])
                }}
                options={devices.map((item) => ({
                  label: `${item.ip}-${item.name}`,
                  value: item.id,
                }))}
                placeholder="请选择"
                style={{ width: 220 }}
                value={query.deviceId}
                virtual={false}
              />
            </Form.Item>
          ) : null}
          {needsSeq(query.backType) ? (
            <Form.Item label="序号">
              <Select
                allowClear
                aria-label="创建序号"
                onChange={(value: number | null) => setQuery({ ...query, deviceSeq: value })}
                options={DEVICE_SEQ_OPTIONS.map((item) => ({ label: String(item), value: item }))}
                placeholder="请选择"
                style={{ width: 160 }}
                value={query.deviceSeq}
                virtual={false}
              />
            </Form.Item>
          ) : null}
          <Form.Item label="账号分组">
            <Space wrap>
              <BusinessLabelFilter
                page={PageKey.AccountPool}
                title="创建账号分组"
                multiple
                onChange={(value) => {
                  setQuery({ ...query, tag: value })
                  setSelectedIds([])
                }}
                options={tagOptions.map((item) => ({
                  label: `${item.tag}(${item.total})`,
                  value: item.tag,
                }))}
                value={[...query.tag]}
              />
              <Button onClick={refreshTags} type="primary">
                刷新
              </Button>
            </Space>
          </Form.Item>
          <Form.Item label="标签组合">
            <Space direction="vertical" size={8}>
              <BusinessLabelFilter
                page={PageKey.AccountPool}
                title="包含标签"
                scope="account-tag"
                multiple
                onChange={(value) => setQuery({ ...query, tagInclude: value })}
                options={bucketOptions.map((item) => ({ label: item, value: item }))}
                value={[...query.tagInclude]}
              />
              <BusinessLabelFilter
                page={PageKey.AccountPool}
                title="排除标签"
                scope="account-tag"
                multiple
                onChange={(value) => setQuery({ ...query, tagExclude: value })}
                options={bucketOptions.map((item) => ({ label: item, value: item }))}
                value={[...query.tagExclude]}
              />
              <Radio.Group
                onChange={(event) => setQuery({ ...query, tagQueryMode: event.target.value })}
                options={[
                  { label: "AND", value: "AND" },
                  { label: "OR", value: "OR" },
                ]}
                size="small"
                value={query.tagQueryMode}
              />
            </Space>
          </Form.Item>
          <Form.Item label="账号状态">
            <Select
              allowClear
              aria-label="创建账号状态"
              onChange={(value: string | null) => setQuery({ ...query, status: value ?? "" })}
              options={[...STATUS_OPTIONS]}
              placeholder="请选择"
              style={{ width: 220 }}
              value={query.status.length === 0 ? null : query.status}
              virtual={false}
            />
          </Form.Item>
          <Form.Item label="在线状态">
            <Select
              allowClear
              aria-label="创建在线状态"
              onChange={(value: boolean | null) => setQuery({ ...query, online: value })}
              options={[
                { label: "在线", value: true },
                { label: "离线", value: false },
              ]}
              placeholder="请选择"
              style={{ width: 220 }}
              value={query.online}
              virtual={false}
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input
              aria-label="创建备注"
              onChange={(event) => setRemark(event.target.value)}
              placeholder="请输入备注"
              value={remark}
            />
          </Form.Item>
          <Form.Item label="循环次数">
            <InputNumber
              aria-label="循环次数"
              max={20}
              min={1}
              onChange={(value) => setTimes(value ?? 1)}
              value={times}
            />
          </Form.Item>
        </Form>
        <div className="pool-create-table">
          {source.error ? <Alert type="error" showIcon message="候选账号加载失败" /> : null}
          <Table
            columns={columns}
            dataSource={[...source.items]}
            loading={source.loading}
            pagination={{
              current: source.page,
              pageSize,
              total: source.total,
              pageSizeOptions: [10, 50, 100, 200, 300, 400],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page, size) => {
                setPageSize(size)
                source.setPage(size === pageSize ? page : 1)
              },
            }}
            rowKey={(item) => item.recordId ?? String(item.id)}
            rowSelection={{
              columnTitle: (
                <FilteredSelectCheckbox
                  busy={selectingAll}
                  filteredCount={selectionCoversFilter ? selectedIds.length : source.total}
                  onClear={() => {
                    setSelectedIds([])
                    setSelectionCoversFilter(false)
                  }}
                  onSelectAll={() => void selectAllSources()}
                  selectedCount={selectedIds.length}
                />
              ),
              getCheckboxProps: (item: MytAccount) => ({
                "aria-label": `选择账号 ${item.uid}`,
                disabled: !canJoinPool(item),
              }),
              preserveSelectedRowKeys: true,
              onChange: (keys, _rows, info) => {
                if (info.type === "all" || info.type === "none") return
                setSelectionCoversFilter(false)
                setSelectedIds(keys.map(String).slice(0, CREATE_LIMIT))
              },
              selectedRowKeys: [...selectedIds],
            }}
            scroll={{ x: "max-content", y: 500 }}
            size="small"
          />
        </div>
      </div>
    </Modal>
  )
}

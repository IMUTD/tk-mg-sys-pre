import type { TableColumnsType } from "antd"
import {
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
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

import { type AccountDevice, type MytAccount, STATUS_OPTIONS } from "../accounts/myt-account"
import {
  CREATE_BACK_TYPE_OPTIONS,
  type CreatePoolQuery,
  canJoinPool,
  createPoolFromAccounts,
  DEVICE_SEQ_OPTIONS,
  emptyCreatePoolQuery,
  filterSourceAccounts,
  type MytTaskRes,
  needsDevice,
  needsSeq,
  nowText,
  shortDate,
  statusLabel,
  uniqueSourceTags,
  uniqueTagBuckets,
} from "./myt-task-res"

type CreatePoolDialogProps = {
  readonly devices: readonly AccountDevice[]
  readonly nextId: number
  readonly onCancel: () => void
  readonly onSubmit: (pool: MytTaskRes) => void
  readonly sourceAccounts: readonly MytAccount[]
}

const CREATE_LIMIT = 3000

export const CreatePoolDialog = ({
  devices,
  nextId,
  onCancel,
  onSubmit,
  sourceAccounts,
}: CreatePoolDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [query, setQuery] = useState<CreatePoolQuery>(emptyCreatePoolQuery)
  const [remark, setRemark] = useState("")
  const [times, setTimes] = useState(1)
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const tagOptions = useMemo(() => uniqueSourceTags(sourceAccounts, query), [query, sourceAccounts])
  const bucketOptions = useMemo(() => uniqueTagBuckets(sourceAccounts), [sourceAccounts])
  const matched = useMemo(
    () => filterSourceAccounts(sourceAccounts, query),
    [query, sourceAccounts],
  )
  const selected = matched.filter((item) => selectedIds.includes(item.id))

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
    message.success("刷新成功")
  }

  const create = (type: 1 | 2): void => {
    if (needsDevice(query.backType) && query.deviceId === null) {
      message.error("请选择设备")
      return
    }
    const candidates = type === 1 ? matched.slice(0, CREATE_LIMIT) : selected
    if (type === 1 && candidates.length === 0) {
      message.warning("没有可新建的账号")
      return
    }
    if (type === 2 && candidates.length === 0) {
      message.warning("请选择要新建的账号")
      return
    }
    onSubmit(
      createPoolFromAccounts(
        candidates,
        {
          backType: query.backType,
          deviceId: query.deviceId,
          deviceSeq: needsSeq(query.backType) ? query.deviceSeq : null,
          key: remark.trim().length === 0 ? `池-${nextId}` : remark.trim(),
          remark,
          tag: query.tag,
          times,
        },
        nextId,
        nowText(),
      ),
    )
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
    { dataIndex: "remark", ellipsis: true, key: "remark", title: "备注" },
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
          <Button onClick={() => create(1)}>
            新建所有({matched.length > CREATE_LIMIT ? "最多3000" : matched.length})
          </Button>
          <Button onClick={() => create(2)} type="primary">
            新建选中({selected.length})
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
              <Select
                aria-label="创建账号分组"
                mode="multiple"
                onChange={(value: string[]) => {
                  setQuery({ ...query, tag: value })
                  setSelectedIds([])
                }}
                options={tagOptions.map((item) => ({
                  label: `${item.tag}(${item.total})`,
                  value: item.tag,
                }))}
                placeholder="请选择"
                style={{ width: 180 }}
                value={[...query.tag]}
                virtual={false}
              />
              <Button onClick={refreshTags} type="primary">
                刷新
              </Button>
            </Space>
          </Form.Item>
          <Form.Item label="标签组合">
            <Space direction="vertical" size={8}>
              <Select
                allowClear
                aria-label="包含标签"
                mode="multiple"
                onChange={(value: string[]) => setQuery({ ...query, tagInclude: value })}
                options={bucketOptions.map((item) => ({ label: item, value: item }))}
                placeholder="包含标签"
                style={{ width: 220 }}
                value={[...query.tagInclude]}
                virtual={false}
              />
              <Select
                allowClear
                aria-label="排除标签"
                mode="multiple"
                onChange={(value: string[]) => setQuery({ ...query, tagExclude: value })}
                options={bucketOptions.map((item) => ({ label: item, value: item }))}
                placeholder="排除标签"
                style={{ width: 220 }}
                value={[...query.tagExclude]}
                virtual={false}
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
          <Table
            columns={columns}
            dataSource={matched}
            pagination={{
              pageSize: 10,
              pageSizeOptions: [10, 50, 100, 200, 300, 400],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            rowKey="id"
            rowSelection={{
              getCheckboxProps: (item: MytAccount) => ({
                "aria-label": `选择账号 ${item.uid}`,
              }),
              onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  type TableColumnsType,
  Tabs,
  Tag,
} from "antd"
import { type ReactNode, useState } from "react"

import { mallRequestError } from "../mall/api"
import { formatTime } from "../mall/catalog"
import type { MerchantApi, TransferableResource, TransferRecord } from "./api"
import { GroupPicker, type PickedGroup } from "./group-picker"
import { blockLabel, mergePicked, pickedNames, statusLabel } from "./transfer-labels"
import "../mall/mall.css"

const PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [20, 50, 100]
const MAX_PICKED = 1000

type Kind = TransferableResource["kind"]

const TRANSFER_EFFECTS: Readonly<Record<Kind, string>> = {
  account: "账号的密码等资料会保留。原来的设备、代理、备份、转移码、标签和备注都会清掉。",
  proxy: "代理的地址和凭据会保留。标签和备注会清掉。",
}

const TransferForm = ({
  api,
  kind,
  noun,
}: {
  readonly api: MerchantApi
  readonly kind: Kind
  readonly noun: string
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [source, setSource] = useState<PickedGroup | null>(null)
  const [target, setTarget] = useState<PickedGroup | null>(null)
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [picked, setPicked] = useState<readonly TransferableResource[]>([])
  const [confirming, setConfirming] = useState(false)

  const query =
    source === null
      ? null
      : {
          groupId: source.groupId,
          page,
          pageSize,
          ...(applied.length > 0 ? { keyword: applied } : {}),
        }
  const resources = useQuery({
    enabled: query !== null,
    queryFn: () => api.transferable(kind, query ?? { groupId: "", page: 1, pageSize: 1 }),
    queryKey: ["merchant", "transferable", kind, query],
  })

  const transfer = useMutation({
    mutationFn: () =>
      api.transfer({
        ids: picked.map((row) => row.id),
        kind,
        sourceGroupId: source?.groupId ?? "",
        targetGroupId: target?.groupId ?? "",
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      setConfirming(false)
      // 选中的可能已经不能转了，又可能翻页后看不到，所以清空让操作人重新选。
      setPicked([])
      await client.invalidateQueries({ queryKey: ["merchant", "transferable"] })
    },
    onSuccess: async (result) => {
      message.success(
        result.replayed
          ? `这些${noun}已经在「${target?.name ?? ""}」了`
          : `已将 ${result.moved} 个${noun}转移到「${target?.name ?? ""}」`,
      )
      setConfirming(false)
      setPicked([])
      setPage(1)
      await client.invalidateQueries({ queryKey: ["merchant"] })
    },
  })

  const columns: TableColumnsType<TransferableResource> = [
    { dataIndex: "name", title: noun === "账号" ? "账号" : "名字" },
    { dataIndex: "detail", title: kind === "account" ? "标识" : "地址" },
    {
      dataIndex: "tags",
      render: (tags: readonly string[]) => tags.filter((tag) => tag.length > 0).join("、"),
      title: "标签",
    },
    {
      dataIndex: "status",
      render: (value: string) => statusLabel(value),
      title: "状态",
      width: 90,
    },
    {
      dataIndex: "blockedBy",
      render: (value: TransferableResource["blockedBy"]) =>
        value === null ? null : <Tag color="warning">{blockLabel(value)}</Tag>,
      title: "不可转移原因",
      width: 130,
    },
  ]

  return (
    <>
      <Card size="small">
        <Space wrap>
          <GroupPicker
            api={api}
            label="来源分组"
            onChange={(group) => {
              setSource(group)
              setPicked([])
              setPage(1)
              setKeyword("")
              setApplied("")
              if (group?.groupId === target?.groupId) setTarget(null)
            }}
            value={source}
          />
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={kind === "account" ? "账号或标识" : "名字或地址"}
            style={{ width: 180 }}
            value={keyword}
          />
          <Button
            disabled={source === null}
            onClick={() => {
              setPage(1)
              setApplied(keyword.trim())
            }}
          >
            搜索
          </Button>
          <GroupPicker
            api={api}
            excludeGroupId={source?.groupId}
            label="转移到"
            onChange={setTarget}
            value={target}
          />
          <Button
            disabled={
              picked.length === 0 ||
              picked.length > MAX_PICKED ||
              source === null ||
              target === null
            }
            onClick={() => setConfirming(true)}
            type="primary"
          >
            转移
          </Button>
          <span aria-label="已选数量" role="status">
            已选 {picked.length} 个{picked.length > MAX_PICKED ? `，单次最多 ${MAX_PICKED} 个` : ""}
          </span>
        </Space>
      </Card>
      {resources.isError ? <Alert title="列表加载失败，请稍后重试" type="error" /> : null}
      {source === null ? (
        <Alert title={`先选来源分组，再选要转移的${noun}`} type="info" />
      ) : (
        <Table
          columns={columns}
          dataSource={[...(resources.data?.items ?? [])]}
          loading={resources.isFetching}
          pagination={{
            current: page,
            onChange: (next, size) => {
              setPage(next)
              setPageSize(size)
            },
            pageSize,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showSizeChanger: true,
            total: resources.data?.total ?? 0,
          }}
          rowKey="id"
          rowSelection={{
            getCheckboxProps: (row) => ({ disabled: row.blockedBy !== null }),
            onChange: (keys) => setPicked(mergePicked(keys, picked, resources.data?.items ?? [])),
            preserveSelectedRowKeys: true,
            selectedRowKeys: picked.map((row) => row.id),
          }}
          scroll={{ x: "max-content" }}
          size="small"
        />
      )}
      {confirming ? (
        <Modal
          cancelText="取消"
          confirmLoading={transfer.isPending}
          mask={{ closable: false }}
          okText="确认转移"
          onCancel={() => setConfirming(false)}
          onOk={() => transfer.mutate()}
          open
          title={`转移${noun}`}
        >
          <p>
            将 {picked.length} 个{noun}从「{source?.name}」转移到「{target?.name}」。
          </p>
          <p>{pickedNames(picked)}</p>
          <p>{TRANSFER_EFFECTS[kind]}</p>
        </Modal>
      ) : null}
    </>
  )
}

const TransferRecords = ({
  api,
  kind,
}: {
  readonly api: MerchantApi
  readonly kind: Kind
}): ReactNode => {
  const [page, setPage] = useState(1)
  const query = { kind, page, pageSize: PAGE_SIZE }
  const records = useQuery({
    queryFn: () => api.transfers(query),
    queryKey: ["merchant", "transfers", query],
  })
  const columns: TableColumnsType<TransferRecord> = [
    { dataIndex: "displayName", title: "名称" },
    { dataIndex: "sourceGroupName", title: "来源分组" },
    { dataIndex: "targetGroupName", title: "目标分组" },
    {
      render: (_value, record) => record.orderNo ?? (record.reason || "手动转移"),
      title: "来源",
    },
    { dataIndex: "movedByName", title: "操作人" },
    {
      dataIndex: "createdAt",
      render: (value: string) => formatTime(value),
      title: "时间",
      width: 170,
    },
  ]
  return (
    <>
      {records.isError ? <Alert title="转移记录加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(records.data?.items ?? [])]}
        loading={records.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: records.data?.total ?? 0,
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </>
  )
}

export const TransferPage = ({
  api,
  kind,
  noun,
}: {
  readonly api: MerchantApi
  readonly kind: Kind
  readonly noun: string
}): ReactNode => (
  <section className="module-page mall-page">
    <Tabs
      destroyOnHidden
      items={[
        {
          children: <TransferForm api={api} kind={kind} noun={noun} />,
          key: "transfer",
          label: `转移${noun}`,
        },
        {
          children: <TransferRecords api={api} kind={kind} />,
          key: "records",
          label: "转移记录",
        },
      ]}
    />
  </section>
)

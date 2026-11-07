import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, App, Button, Input, Modal, Space, Table, type TableColumnsType } from "antd"
import { type ReactNode, useState } from "react"

import { type MallOrderRecord, mallRequestError } from "../mall/api"
import { formatTime, productKindLabel } from "../mall/catalog"
import type { MerchantApi, TransferableResource, TransferRecord } from "./api"
import { GroupPicker, type PickedGroup } from "./group-picker"
import { mergePicked, pickedNames, statusLabel } from "./transfer-labels"

const PICK_PAGE_SIZE = 50
const RECORD_PAGE_SIZE = 20

export const ShipDialog = ({
  api,
  onClose,
  order,
}: {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly order: MallOrderRecord
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const kind = order.productKind ?? "account"
  const noun = productKindLabel(kind)
  const quantity = order.quantity ?? 0
  // 商品绑定了库存分组时只能从那里发，服务端也会检查。
  const boundGroup =
    order.inventoryGroupId === null || order.inventoryGroupId === undefined
      ? null
      : { groupId: order.inventoryGroupId, name: order.inventoryGroupName ?? "" }
  const [source, setSource] = useState<PickedGroup | null>(boundGroup)
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState("")
  const [page, setPage] = useState(1)
  const [picked, setPicked] = useState<readonly TransferableResource[]>([])

  const query =
    source === null
      ? null
      : {
          groupId: source.groupId,
          page,
          pageSize: PICK_PAGE_SIZE,
          shippableOnly: true,
          ...(applied.length > 0 ? { keyword: applied } : {}),
        }
  const resources = useQuery({
    enabled: query !== null,
    queryFn: () => api.transferable(kind, query ?? { groupId: "", page: 1, pageSize: 1 }),
    queryKey: ["merchant", "transferable", kind, query],
  })
  const rows = resources.data?.items ?? []

  const ship = useMutation({
    mutationFn: () =>
      api.shipOrder(order.id, {
        ids: picked.map((row) => row.id),
        sourceGroupId: source?.groupId ?? "",
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      setPicked([])
      await client.invalidateQueries({ queryKey: ["merchant"] })
    },
    onSuccess: async (result) => {
      message.success(
        result.replayed
          ? "这笔订单已经发过货了"
          : `已把 ${result.moved} 个${noun}发给「${order.groupName}」`,
      )
      onClose()
      await Promise.all([
        client.invalidateQueries({ queryKey: ["merchant"] }),
        client.invalidateQueries({ queryKey: ["mall"] }),
      ])
    },
  })

  const pickPage = (): void => {
    const free = rows.filter((row) => !picked.some((item) => item.id === row.id))
    setPicked([...picked, ...free.slice(0, quantity - picked.length)])
  }

  const columns: TableColumnsType<TransferableResource> = [
    { dataIndex: "name", title: noun },
    { dataIndex: "detail", title: kind === "account" ? "标识" : "地址" },
    {
      dataIndex: "status",
      render: (value: string) => statusLabel(value),
      title: "状态",
      width: 80,
    },
  ]

  return (
    <Modal
      cancelText="返回"
      confirmLoading={ship.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: source === null || picked.length !== quantity }}
      okText="确认发货"
      onCancel={onClose}
      onOk={() => ship.mutate()}
      open
      title={`发货 ${order.orderNo}`}
      width={720}
    >
      <p>
        买家「{order.groupName}」购买 {order.product} × {quantity}
      </p>
      <Space style={{ marginBottom: 12 }} wrap>
        {boundGroup === null ? (
          <GroupPicker
            api={api}
            excludeGroupId={order.groupId}
            label="来源分组"
            onChange={(group) => {
              setSource(group)
              setPicked([])
              setPage(1)
              setKeyword("")
              setApplied("")
            }}
            value={source}
          />
        ) : (
          <span>来源分组：{boundGroup.name}（商品绑定）</span>
        )}
        <Input
          allowClear
          aria-label="搜索"
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="名称或标识"
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
        <Button disabled={rows.length === 0 || picked.length >= quantity} onClick={pickPage}>
          选中本页
        </Button>
        <span aria-label="已选数量" role="status">
          已选 {picked.length} / {quantity}
        </span>
      </Space>
      {resources.isError ? <Alert title="列表加载失败，请稍后重试" type="error" /> : null}
      {source === null ? (
        <Alert
          title={`先选来源分组。分组里的${noun}会转给买家，请确认选的是平台库存。`}
          type="info"
        />
      ) : (
        <div style={{ maxHeight: 400, overflow: "auto" }}>
          <Table
            columns={columns}
            dataSource={[...rows]}
            loading={resources.isFetching}
            locale={{ emptyText: `这个分组没有可发货的${noun}` }}
            pagination={{
              current: page,
              onChange: setPage,
              pageSize: PICK_PAGE_SIZE,
              showSizeChanger: false,
              total: resources.data?.total ?? 0,
            }}
            rowKey="id"
            rowSelection={{
              getCheckboxProps: (row) => ({
                disabled: picked.length >= quantity && !picked.some((item) => item.id === row.id),
              }),
              hideSelectAll: true,
              onChange: (keys) => setPicked(mergePicked(keys, picked, rows)),
              preserveSelectedRowKeys: true,
              selectedRowKeys: picked.map((row) => row.id),
            }}
            size="small"
          />
        </div>
      )}
      {source !== null && picked.length === quantity ? (
        <Alert
          style={{ marginTop: 12 }}
          title={`将从「${source.name}」转 ${quantity} 个${noun}给「${order.groupName}」。发货后订单不能取消，${noun}原有的绑定、标签和备注会被清掉。发货内容：${pickedNames(picked)}`}
          type="warning"
        />
      ) : null}
    </Modal>
  )
}

export const ShipmentRecordsDialog = ({
  api,
  onClose,
  order,
}: {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly order: MallOrderRecord
}): ReactNode => {
  const [page, setPage] = useState(1)
  const query = { orderId: order.id, page, pageSize: RECORD_PAGE_SIZE }
  const records = useQuery({
    queryFn: () => api.transfers(query),
    queryKey: ["merchant", "transfers", query],
  })
  const columns: TableColumnsType<TransferRecord> = [
    { dataIndex: "displayName", title: "名称" },
    { dataIndex: "sourceGroupName", title: "来源分组" },
    { dataIndex: "movedByName", title: "操作人" },
    {
      dataIndex: "createdAt",
      render: (value: string) => formatTime(value),
      title: "时间",
      width: 170,
    },
  ]
  return (
    <Modal footer={null} onCancel={onClose} open title={`发货明细 ${order.orderNo}`} width={720}>
      {records.isError ? <Alert title="明细加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(records.data?.items ?? [])]}
        loading={records.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: RECORD_PAGE_SIZE,
          showSizeChanger: false,
          total: records.data?.total ?? 0,
        }}
        rowKey="id"
        size="small"
      />
    </Modal>
  )
}

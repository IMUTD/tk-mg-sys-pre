import { useQuery } from "@tanstack/react-query"
import { Alert, Modal, Table } from "antd"
import { type IdentityApi, IdentityRequestError, type PlatformIdentity } from "./api"
import { identityErrorText, statusLabels } from "./status"

export const IdentityHistoryDialog = ({
  viewerId,
  target,
  onClose,
  api,
}: {
  readonly viewerId: string
  readonly target: PlatformIdentity | null
  readonly onClose: () => void
  readonly api: IdentityApi
}) => {
  const history = useQuery({
    queryKey: ["identity-history", viewerId, target?.userId],
    enabled: target !== null,
    queryFn: () =>
      target === null
        ? Promise.resolve({ attempts: [], unbindings: [] })
        : api.history(target.userId),
  })
  const rows = [
    ...(history.data?.attempts ?? []).map((item) => ({
      id: item.id,
      action: "核验",
      status: statusLabels[item.status],
      time: item.startedAt,
      detail:
        item.errorCode === null ? "—" : identityErrorText(new IdentityRequestError(item.errorCode)),
    })),
    ...(history.data?.unbindings ?? []).map((item) => ({
      id: item.id,
      action: "解绑",
      status: "已解绑",
      time: item.createdAt,
      detail: item.reason,
    })),
  ].sort((left, right) => right.time.localeCompare(left.time))
  return (
    <Modal
      title={`${target?.displayName || target?.email || ""} 的认证记录`}
      open={target !== null}
      onCancel={onClose}
      footer={null}
    >
      {history.isError ? (
        <Alert type="error" title="读取记录失败" />
      ) : (
        <Table
          rowKey="id"
          loading={history.isPending}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "操作", dataIndex: "action" },
            { title: "状态", dataIndex: "status" },
            {
              title: "时间",
              dataIndex: "time",
              render: (value: string) => new Date(value).toLocaleString("zh-CN"),
            },
            { title: "说明", dataIndex: "detail" },
          ]}
        />
      )}
    </Modal>
  )
}

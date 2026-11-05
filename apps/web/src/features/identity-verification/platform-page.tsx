import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd"
import { useRef, useState } from "react"
import { type IdentityApi, identityApi, type PlatformIdentity } from "./api"
import { IdentityHistoryDialog } from "./history-dialog"
import { identityErrorText, statusLabels } from "./status"

export const PlatformIdentityPage = ({
  viewerId,
  api = identityApi,
}: {
  readonly viewerId: string
  readonly api?: IdentityApi
}) => {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null)
  const [target, setTarget] = useState<PlatformIdentity | null>(null)
  const [historyTarget, setHistoryTarget] = useState<PlatformIdentity | null>(null)
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const commandKey = useRef("")
  const list = useQuery({
    queryKey: ["platform-identities", viewerId, page, search, status, dates],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" })
      if (search !== "") params.set("q", search)
      if (status !== "") params.set("status", status)
      if (dates !== null) {
        params.set("from", dates.from)
        params.set("to", dates.to)
      }
      return api.list(params)
    },
  })
  const openUnbind = (row: PlatformIdentity) => {
    setReason("")
    setPassword("")
    setError("")
    setTarget(row)
    commandKey.current = crypto.randomUUID()
  }
  const close = () => {
    if (!busy) {
      setTarget(null)
      setPassword("")
      setReason("")
      setError("")
    }
  }
  const unbind = async () => {
    if (target === null || busy) return
    if (reason.trim() === "" || password === "") {
      setError("请填写解绑原因和我的登录密码。")
      return
    }
    setBusy(true)
    setError("")
    try {
      await api.unbind(
        target.userId,
        { expectedVersion: target.version, reason: reason.trim(), operatorPassword: password },
        commandKey.current,
      )
      setTarget(null)
      setReason("")
      await queryClient.invalidateQueries({ queryKey: ["platform-identities", viewerId] })
      await queryClient.invalidateQueries({ queryKey: ["identity-history", viewerId] })
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure
      setError(identityErrorText(failure))
      await list.refetch()
    } finally {
      setPassword("")
      setBusy(false)
    }
  }
  return (
    <Card title="管理员实名认证管理">
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary">
          解绑会使目标管理员退出登录，之后需要重新认证；历史订单和任务不会被删除。
        </Typography.Paragraph>
        <Space wrap>
          <Input.Search
            aria-label="搜索管理员账号"
            placeholder="搜索账号或名称"
            allowClear
            onSearch={(value) => {
              setSearch(value)
              setPage(1)
            }}
          />
          <Select
            aria-label="认证状态筛选"
            value={status}
            style={{ minWidth: 140 }}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={[
              { value: "", label: "全部状态" },
              ...["unverified", "verifying", "verified", "rejected", "error", "unbound"].map(
                (value) => ({ value, label: statusLabels[value] }),
              ),
            ]}
          />
          <Button onClick={() => void list.refetch()}>刷新</Button>
          <DatePicker.RangePicker
            placeholder={["认证开始日期", "认证结束日期"]}
            onChange={(value) => {
              setDates(
                value?.[0] && value[1]
                  ? {
                      from: value[0].startOf("day").toISOString(),
                      to: value[1].endOf("day").toISOString(),
                    }
                  : null,
              )
              setPage(1)
            }}
          />
        </Space>
        {list.isError && <Alert type="error" title={identityErrorText(list.error)} />}
        <Table<PlatformIdentity>
          rowKey="userId"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 820 }}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            {
              title: "管理员",
              key: "account",
              render: (_, row) => (
                <>
                  <div>{row.displayName || row.email}</div>
                  <Typography.Text type="secondary">{row.email}</Typography.Text>
                </>
              ),
            },
            {
              title: "姓名",
              dataIndex: "maskedName",
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "身份证号",
              dataIndex: "maskedNumber",
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "状态",
              key: "status",
              render: (_, row) => (
                <Tag color={row.status === "verified" ? "success" : "default"}>
                  {statusLabels[row.status]}
                </Tag>
              ),
            },
            {
              title: "认证时间",
              dataIndex: "verifiedAt",
              render: (value: string | null) =>
                value === null ? "—" : new Date(value).toLocaleString("zh-CN"),
            },
            {
              title: "操作",
              key: "actions",
              render: (_, row) => (
                <Space>
                  <Button size="small" onClick={() => setHistoryTarget(row)}>
                    记录
                  </Button>
                  <Button
                    danger
                    size="small"
                    disabled={row.status !== "verified" && row.status !== "verifying"}
                    onClick={() => openUnbind(row)}
                  >
                    解除绑定
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Space>
      <Modal
        title="解除身份证绑定"
        open={target !== null}
        onCancel={close}
        maskClosable={!busy}
        closable={!busy}
        footer={
          <Space>
            <Button disabled={busy} onClick={close}>
              取消
            </Button>
            <Button danger type="primary" loading={busy} onClick={() => void unbind()}>
              确认解绑
            </Button>
          </Space>
        }
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            title={`将解除 ${target?.email ?? ""} 的实名绑定`}
            description="目标管理员的全部会话将失效，重新登录后需要再次认证。此操作不会删除阿里云侧的历史核验记录。"
          />
          {error !== "" && <Alert type="error" title={error} />}
          <label htmlFor="unbind-reason">解绑原因</label>
          <Input.TextArea
            id="unbind-reason"
            value={reason}
            disabled={busy}
            maxLength={200}
            placeholder="请填写处理原因，不要包含身份证号等个人信息"
            onChange={(e) => {
              setReason(e.target.value)
              commandKey.current = crypto.randomUUID()
            }}
          />
          <label htmlFor="unbind-password">我的登录密码</label>
          <Input.Password
            id="unbind-password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Space>
      </Modal>
      <IdentityHistoryDialog
        viewerId={viewerId}
        target={historyTarget}
        onClose={() => setHistoryTarget(null)}
        api={api}
      />
    </Card>
  )
}

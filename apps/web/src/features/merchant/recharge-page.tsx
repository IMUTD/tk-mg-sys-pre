import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  type TableColumnsType,
  Tag,
  Typography,
} from "antd"
import { type ReactNode, useState } from "react"

import { type GroupWallet, type LedgerEntry, mallRequestError } from "../mall/api"
import { formatTime, pointTypeLabel } from "../mall/catalog"
import { createMerchantApi, type MerchantApi } from "./api"
import "../mall/mall.css"

const defaultApi = createMerchantApi()
const PAGE_SIZE = 20
const POINTS_PER_YUAN = 100
const REMARK_MAX_LENGTH = 500
const AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/

const points = (value: number): string => value.toLocaleString("zh-CN")

/** 只用于预览；实际到账积分以服务端按字符串金额计算的结果为准。 */
const previewPoints = (amountYuan: string): number | null => {
  if (!AMOUNT_PATTERN.test(amountYuan)) return null
  const [whole = "0", fraction = ""] = amountYuan.split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return cents > 0 ? (cents * POINTS_PER_YUAN) / 100 : null
}

type Dialog =
  | { readonly kind: "adjust"; readonly wallet: GroupWallet }
  | { readonly kind: "recharge"; readonly wallet: GroupWallet }

const ledgerColumns: TableColumnsType<LedgerEntry> = [
  { dataIndex: "createdAt", render: formatTime, title: "操作时间", width: 180 },
  { dataIndex: "groupName", title: "分组", width: 140 },
  {
    dataIndex: "type",
    render: (value: LedgerEntry["type"]) => <Tag>{pointTypeLabel(value)}</Tag>,
    title: "类型",
    width: 80,
  },
  {
    dataIndex: "delta",
    render: (value: number) => (value > 0 ? `+${points(value)}` : points(value)),
    title: "积分变动",
    width: 120,
  },
  { dataIndex: "balance", render: points, title: "余额", width: 120 },
  { dataIndex: "orderNo", title: "订单号", width: 200 },
  { dataIndex: "remark", title: "备注" },
  { dataIndex: "actorName", title: "操作人", width: 140 },
]

export const MerchantRechargePage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => {
  const [keyword, setKeyword] = useState("")
  const [appliedKeyword, setAppliedKeyword] = useState("")
  const [walletPage, setWalletPage] = useState(1)
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerWallet, setLedgerWallet] = useState<GroupWallet | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const walletQuery = {
    page: walletPage,
    pageSize: PAGE_SIZE,
    ...(appliedKeyword.length > 0 ? { keyword: appliedKeyword } : {}),
  }
  const wallets = useQuery({
    queryFn: () => api.wallets(walletQuery),
    queryKey: ["merchant", "wallets", walletQuery],
  })
  const ledgerQuery = {
    page: ledgerPage,
    pageSize: PAGE_SIZE,
    ...(ledgerWallet === null ? {} : { groupId: ledgerWallet.groupId }),
  }
  const ledger = useQuery({
    queryFn: () => api.ledger(ledgerQuery),
    queryKey: ["merchant", "ledger", ledgerQuery],
  })

  const walletColumns: TableColumnsType<GroupWallet> = [
    { dataIndex: "name", title: "分组" },
    { dataIndex: "balance", render: points, title: "积分余额", width: 160 },
    {
      render: (_value, wallet) => (
        <Space>
          <Button
            aria-label={`充值${wallet.name}`}
            onClick={() => setDialog({ kind: "recharge", wallet })}
            size="small"
            type="primary"
          >
            充值
          </Button>
          <Button
            aria-label={`调账${wallet.name}`}
            onClick={() => setDialog({ kind: "adjust", wallet })}
            size="small"
          >
            调账
          </Button>
          <Button
            aria-label={`查看${wallet.name}流水`}
            onClick={() => {
              setLedgerPage(1)
              setLedgerWallet(wallet)
            }}
            size="small"
          >
            流水
          </Button>
        </Space>
      ),
      title: "操作",
      width: 220,
    },
  ]

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            aria-label="分组名称"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="分组名称"
            style={{ width: 220 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              setWalletPage(1)
              setAppliedKeyword(keyword.trim())
            }}
            type="primary"
          >
            搜索
          </Button>
        </Space>
      </Card>
      {wallets.isError ? <Alert title="分组余额加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={walletColumns}
        dataSource={[...(wallets.data?.items ?? [])]}
        loading={wallets.isFetching}
        pagination={{
          current: walletPage,
          onChange: setWalletPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: wallets.data?.total ?? 0,
        }}
        rowKey="groupId"
        size="small"
      />
      <Card
        extra={
          ledgerWallet === null ? null : (
            <Button
              onClick={() => {
                setLedgerPage(1)
                setLedgerWallet(null)
              }}
              size="small"
            >
              查看全部
            </Button>
          )
        }
        size="small"
        title={ledgerWallet === null ? "全部积分流水" : `${ledgerWallet.name}的积分流水`}
      >
        {ledger.isError ? <Alert title="积分流水加载失败，请稍后重试" type="error" /> : null}
        <Table
          columns={ledgerColumns}
          dataSource={[...(ledger.data?.items ?? [])]}
          loading={ledger.isFetching}
          pagination={{
            current: ledgerPage,
            onChange: setLedgerPage,
            pageSize: PAGE_SIZE,
            showSizeChanger: false,
            total: ledger.data?.total ?? 0,
          }}
          rowKey="id"
          scroll={{ x: "max-content" }}
          size="small"
        />
      </Card>
      {dialog?.kind === "recharge" ? (
        <RechargeDialog api={api} onClose={() => setDialog(null)} wallet={dialog.wallet} />
      ) : null}
      {dialog?.kind === "adjust" ? (
        <AdjustDialog api={api} onClose={() => setDialog(null)} wallet={dialog.wallet} />
      ) : null}
    </section>
  )
}

type DialogProps = {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly wallet: GroupWallet
}

const useRefreshBalances = (): (() => Promise<void>) => {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["merchant"] }),
      client.invalidateQueries({ queryKey: ["mall"] }),
    ])
  }
}

const RemarkField = ({
  onChange,
  placeholder,
  value,
}: {
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly value: string
}): ReactNode => (
  <Form.Item label="备注" required>
    <Input.TextArea
      aria-label="备注"
      maxLength={REMARK_MAX_LENGTH}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={2}
      value={value}
    />
  </Form.Item>
)

const RechargeDialog = ({ api, onClose, wallet }: DialogProps): ReactNode => {
  const { message } = App.useApp()
  const refresh = useRefreshBalances()
  // 弹窗打开期间固定一个幂等键：网络失败后重试不会重复入账。
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [amountYuan, setAmountYuan] = useState("")
  const [remark, setRemark] = useState("")
  const preview = previewPoints(amountYuan)
  const mutation = useMutation({
    mutationFn: () =>
      api.recharge({
        amountYuan,
        groupId: wallet.groupId,
        idempotencyKey,
        remark: remark.trim(),
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
    },
    onSuccess: async (result) => {
      message.success(`已到账 ${points(result.points)} 积分，当前余额 ${points(result.balance)}`)
      onClose()
      await refresh()
    },
  })

  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: preview === null || remark.trim().length === 0 }}
      okText="确认充值"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title={`充值：${wallet.name}`}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="当前余额">{points(wallet.balance)} 积分</Form.Item>
        <Form.Item label="收款金额" required>
          <InputNumber
            aria-label="收款金额"
            max="99999999.99"
            min="0.01"
            onChange={(value) => setAmountYuan(value ?? "")}
            precision={2}
            stringMode
            style={{ width: 220 }}
            suffix="元"
            value={amountYuan.length === 0 ? null : amountYuan}
          />
        </Form.Item>
        <Form.Item label="到账积分">
          <Typography.Text strong>{preview === null ? "-" : points(preview)}</Typography.Text>
        </Form.Item>
        <RemarkField
          onChange={setRemark}
          placeholder="填写打款凭证或流水号，买家可以看到"
          value={remark}
        />
      </Form>
    </Modal>
  )
}

const AdjustDialog = ({ api, onClose, wallet }: DialogProps): ReactNode => {
  const { message } = App.useApp()
  const refresh = useRefreshBalances()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [delta, setDelta] = useState<number | null>(null)
  const [remark, setRemark] = useState("")
  const mutation = useMutation({
    mutationFn: () =>
      api.adjust({
        delta: delta ?? 0,
        groupId: wallet.groupId,
        idempotencyKey,
        remark: remark.trim(),
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
    },
    onSuccess: async (result) => {
      message.success(`调账完成，当前余额 ${points(result.balance)}`)
      onClose()
      await refresh()
    },
  })
  const invalid = delta === null || delta === 0 || remark.trim().length === 0

  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: invalid }}
      okText="确认调账"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title={`调账：${wallet.name}`}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="当前余额">{points(wallet.balance)} 积分</Form.Item>
        <Form.Item extra="正数加积分，负数扣积分" label="积分变动" required>
          <InputNumber
            aria-label="积分变动"
            onChange={(value) => setDelta(value)}
            precision={0}
            style={{ width: 220 }}
            value={delta}
          />
        </Form.Item>
        <RemarkField onChange={setRemark} placeholder="填写调账原因，买家可以看到" value={remark} />
      </Form>
    </Modal>
  )
}

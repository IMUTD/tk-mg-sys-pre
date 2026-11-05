import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../../lib/api/api-fetch"

import {
  daysLeft,
  type ExpiryState,
  expiringDays,
  expirySortKey,
  expiryState,
  formatTime,
  renewedUntil,
} from "./service-time"

type Plan = {
  readonly amount: string
  readonly label: string
  readonly months: 1 | 3 | 6 | 12
}

type BoxRow = {
  readonly externalId: string
  readonly host: string
  readonly limited: boolean
  readonly name: string
  readonly serviceUntil: string | null
}

type Catalog = {
  readonly alipayReady: boolean
  readonly boxes: readonly BoxRow[]
  readonly plans: readonly Plan[]
  readonly platformAdmin?: boolean
}

type Notice = { readonly text: string; readonly type: "error" | "info" | "success" | "warning" }

type ReconcileReply = { readonly error?: string; readonly ok?: boolean; readonly pending?: boolean }

// Alipay usually confirms within seconds of the redirect; give it about 15 seconds.
const confirmAttempts = 6
const confirmIntervalMs = 3_000

const stateFilters: readonly { readonly label: string; readonly value: ExpiryState }[] = [
  { label: "未开通", value: "none" },
  { label: "已到期", value: "expired" },
  { label: `${expiringDays} 天内到期`, value: "expiring" },
  { label: "正常", value: "active" },
]

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "请求失败"
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const untilText = (value: string | null): string => {
  if (value === null) return "未开通"
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? "未开通" : formatTime(time)
}

const ExpiryCell = ({ row }: { readonly row: BoxRow }) => {
  const state = expiryState(row.serviceUntil)
  const text = untilText(row.serviceUntil)
  return (
    <Space size={4} wrap>
      {state === "none" ? <Tag>未开通</Tag> : null}
      {state === "expired" ? <Tag color="error">{text}（已到期）</Tag> : null}
      {state === "expiring" ? (
        <>
          <Tag color="warning">{text}</Tag>
          <Typography.Text type="warning">剩 {daysLeft(row.serviceUntil)} 天</Typography.Text>
        </>
      ) : null}
      {state === "active" ? (
        <>
          <Tag color="success">{text}</Tag>
          <Typography.Text type="secondary">剩 {daysLeft(row.serviceUntil)} 天</Typography.Text>
        </>
      ) : null}
      {row.limited ? null : <Tag>测试期不限制</Tag>}
    </Space>
  )
}

export const BoxServicePage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [keyword, setKeyword] = useState("")
  const [state, setState] = useState<"" | ExpiryState>("")
  const [page, setPage] = useState(1)
  const [renewing, setRenewing] = useState<BoxRow | null>(null)
  const [months, setMonths] = useState<Plan["months"]>(1)
  const [paying, setPaying] = useState(false)
  const confirming = useRef("")

  const load = useCallback(async () => {
    const response = await apiFetch("/api/box-service", { credentials: "include" })
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    setCatalog((await response.json()) as Catalog)
    setError("")
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Back from Alipay: the notify may land a few seconds after the redirect, so keep asking
  // while Alipay says the payment is not settled yet instead of reporting a failure.
  const confirmPayment = useCallback(
    async (outTradeNo: string) => {
      setNotice({ text: "正在确认支付结果…", type: "info" })
      for (let attempt = 0; attempt < confirmAttempts; attempt += 1) {
        if (attempt > 0) await wait(confirmIntervalMs)
        const response = await apiFetch("/api/box-service/orders/reconcile", {
          body: JSON.stringify({ outTradeNo }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "POST",
        }).catch(() => null)
        const body =
          response === null
            ? null
            : ((await response.json().catch(() => null)) as ReconcileReply | null)
        if (response?.ok === true) {
          setNotice({ text: "支付成功，时长已到账。", type: "success" })
          await load()
          return
        }
        if (response !== null && body?.pending !== true) {
          setNotice({ text: body?.error ?? "确认支付结果失败", type: "error" })
          await load()
          return
        }
      }
      setNotice({
        text: "支付宝还没返回支付结果。已付款的订单会自动到账，也可以稍后在「时长订单」里点「查询支付结果」。",
        type: "warning",
      })
      await load()
    },
    [load],
  )

  useEffect(() => {
    // Our own return address carries outTradeNo; Alipay also appends out_trade_no.
    const outTradeNo = searchParams.get("outTradeNo") || searchParams.get("out_trade_no") || ""
    if (outTradeNo === "" || confirming.current === outTradeNo) return
    confirming.current = outTradeNo
    setSearchParams({}, { replace: true })
    void confirmPayment(outTradeNo)
  }, [confirmPayment, searchParams, setSearchParams])

  const counts = useMemo(() => {
    const result: Record<ExpiryState, number> = { active: 0, expired: 0, expiring: 0, none: 0 }
    for (const row of catalog?.boxes ?? []) result[expiryState(row.serviceUntil)] += 1
    return result
  }, [catalog])

  const boxes = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return (catalog?.boxes ?? [])
      .filter((row) => state === "" || expiryState(row.serviceUntil) === state)
      .filter(
        (row) =>
          query === "" ||
          [row.name, row.host, row.externalId].some((value) =>
            (value ?? "").toLowerCase().includes(query),
          ),
      )
      .sort(
        (a, b) =>
          expirySortKey(a.serviceUntil) - expirySortKey(b.serviceUntil) ||
          a.name.localeCompare(b.name, "zh-CN"),
      )
  }, [catalog, keyword, state])

  const alipayReady = catalog?.alipayReady === true
  const plans = catalog?.plans ?? []
  const plan = plans.find((item) => item.months === months) ?? plans[0]

  const openRenew = (row: BoxRow) => {
    setRenewing(row)
    setMonths(plans[0]?.months ?? 1)
    setError("")
  }

  const pay = async () => {
    if (renewing === null || plan === undefined) return
    setPaying(true)
    setError("")
    const response = await apiFetch("/api/box-service/orders", {
      body: JSON.stringify({ externalId: renewing.externalId, months: plan.months }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      setPaying(false)
      setRenewing(null)
      setError(await readError(response))
      return
    }
    const body = (await response.json()) as { payUrl?: string }
    if (body.payUrl === undefined || body.payUrl === "") {
      setPaying(false)
      setRenewing(null)
      setError("没有拿到支付地址")
      return
    }
    window.location.assign(body.payUrl)
  }

  const renewingState = renewing === null ? "none" : expiryState(renewing.serviceUntil)

  return (
    <Card title="盒子使用时长">
      <Typography.Paragraph type="secondary">
        时长绑在设备 ID 上，IP
        变化不影响。点「续费」选择时长并确认到期时间后，跳转支付宝付款。未到期时从当前到期日往后顺延，已到期则从支付成功时起算。受限的盒子未开通或已到期时不能下发新任务，已经在排队的任务会照常执行完；测试阶段只有部分盒子受限。只能给自己和下级名下的盒子购买，还没分配的盒子只有系统账号能看到。
      </Typography.Paragraph>
      {catalog !== null && !alipayReady ? (
        <Typography.Paragraph type="warning">
          {catalog.platformAdmin === true
            ? "还没有配置支付宝。填好 ALIPAY_APP_ID、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY 后才能下单。"
            : "在线支付暂未开通，暂时不能续费，请联系平台。"}
        </Typography.Paragraph>
      ) : null}
      {notice !== null ? (
        <Alert
          closable={{ onClose: () => setNotice(null) }}
          showIcon
          title={notice.text}
          style={{ marginBottom: 16 }}
          type={notice.type}
        />
      ) : null}
      <Space wrap style={{ display: "flex", marginBottom: 16 }}>
        <Input
          allowClear
          placeholder="IP、名字、设备 ID"
          style={{ width: 280 }}
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setPage(1)
          }}
        />
        <Select
          allowClear
          placeholder="到期状态"
          style={{ width: 160 }}
          value={state || undefined}
          options={stateFilters.map((item) => ({
            label: `${item.label}（${counts[item.value]}）`,
            value: item.value,
          }))}
          onChange={(value) => {
            setState(value ?? "")
            setPage(1)
          }}
        />
      </Space>
      {error !== "" ? <Typography.Paragraph type="danger">{error}</Typography.Paragraph> : null}
      <Table<BoxRow>
        rowKey="externalId"
        dataSource={boxes}
        pagination={{
          current: page,
          pageSize: 10,
          showSizeChanger: false,
          onChange: (nextPage) => setPage(nextPage),
        }}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "设备 ID", dataIndex: "externalId" },
          { title: "当前 IP", dataIndex: "host" },
          {
            title: "使用到期",
            dataIndex: "serviceUntil",
            render: (_value: string | null, row: BoxRow) => <ExpiryCell row={row} />,
          },
          {
            title: "操作",
            width: 100,
            render: (_value, row) => (
              <Tooltip title={alipayReady ? "" : "在线支付暂未开通"}>
                <Button
                  disabled={!alipayReady || plans.length === 0}
                  type={expiryState(row.serviceUntil) === "active" ? "default" : "primary"}
                  onClick={() => openRenew(row)}
                >
                  续费
                </Button>
              </Tooltip>
            ),
          },
        ]}
      />
      <Modal
        destroyOnHidden
        confirmLoading={paying}
        okButtonProps={{ disabled: plan === undefined }}
        okText="去支付宝付款"
        open={renewing !== null}
        title="续费盒子使用时长"
        width={560}
        onCancel={() => {
          if (!paying) setRenewing(null)
        }}
        onOk={() => void pay()}
      >
        {renewing === null || plan === undefined ? null : (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text>
              盒子：{renewing.name || renewing.host}（{renewing.externalId}）
            </Typography.Text>
            <Radio.Group
              optionType="button"
              value={plan.months}
              options={plans.map((item) => ({
                label: `${item.label} ¥${item.amount}`,
                value: item.months,
              }))}
              onChange={(event) => setMonths(event.target.value as Plan["months"])}
            />
            <Typography.Text>
              到期时间：{untilText(renewing.serviceUntil)} →{" "}
              <Typography.Text strong>
                {formatTime(renewedUntil(renewing.serviceUntil, plan.months))}
              </Typography.Text>
            </Typography.Text>
            {renewingState === "none" || renewingState === "expired" ? (
              <Typography.Text type="secondary">
                现在没有剩余时长，实际从支付成功时开始计算。
              </Typography.Text>
            ) : null}
            <Typography.Text>
              应付：<Typography.Text strong>¥{plan.amount}</Typography.Text>
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </Card>
  )
}

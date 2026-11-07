import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input, Modal, Space } from "antd"
import { type ReactNode, useState } from "react"

import { type MallApi, mallRequestError, type RechargeOrder } from "./api"
import { pointsText } from "./catalog"

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/

const pointsOf = (amount: string): number =>
  AMOUNT.test(amount) ? Math.round(Number(amount) * 100) : 0

/** 一次打开只用一个幂等键：重复点击不会生成第二笔订单。 */
export const RechargeDialog = ({
  api,
  groupId,
  groupName,
  onClose,
}: {
  readonly api: MallApi
  readonly groupId: string
  readonly groupName: string
  readonly onClose: () => void
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [amount, setAmount] = useState("")
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [order, setOrder] = useState<(RechargeOrder & { readonly payUrl: string | null }) | null>(
    null,
  )
  const points = pointsOf(amount.trim())

  const create = useMutation({
    mutationFn: () => api.createRecharge(groupId, { amountYuan: amount.trim(), idempotencyKey }),
    onError: async (error) => message.error(await mallRequestError(error)),
    onSuccess: setOrder,
  })
  const check = useMutation({
    mutationFn: () => api.rechargeStatus(groupId, order?.orderNo ?? ""),
    onError: async (error) => message.error(await mallRequestError(error)),
    onSuccess: async (current) => {
      if (current.status === "paid") {
        message.success(`已到账 ${pointsText(current.points)}`)
        onClose()
        await client.invalidateQueries({ queryKey: ["mall"] })
        return
      }
      message.warning(
        current.status === "closed" ? "这笔订单已关闭，请重新充值" : "支付宝还没有收到这笔付款",
      )
    },
  })

  return (
    <Modal footer={null} mask={{ closable: false }} onCancel={onClose} open title="积分充值">
      {order === null ? (
        <Form layout="vertical" size="small">
          <p>给「{groupName}」充值，1 元 = 100 积分。</p>
          <Form.Item label="充值金额（元）" required>
            <Input
              aria-label="充值金额"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              value={amount}
            />
          </Form.Item>
          {points > 0 ? <p>到账 {pointsText(points)}</p> : null}
          <Button
            disabled={points <= 0}
            loading={create.isPending}
            onClick={() => create.mutate()}
            type="primary"
          >
            去支付宝付款
          </Button>
        </Form>
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <p>
            订单 {order.orderNo}，到账 {pointsText(order.points)}。
          </p>
          {order.payUrl === null ? (
            <Alert
              title={order.status === "paid" ? "这笔订单已经付过了" : "这笔订单已关闭，请重新充值"}
              type="info"
            />
          ) : (
            <Button href={order.payUrl} rel="noopener noreferrer" target="_blank" type="primary">
              打开支付宝付款
            </Button>
          )}
          <Alert title="付款完成后积分会自动到账，也可以点下面的按钮查询。" type="info" />
          <Button loading={check.isPending} onClick={() => check.mutate()}>
            我已付款，查询结果
          </Button>
        </Space>
      )}
    </Modal>
  )
}

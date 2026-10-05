import { App, Button, Form, InputNumber, Modal, Select, Typography } from "antd"
import { type ReactNode, useState } from "react"

import {
  ACCOUNT_STATUS_OPTIONS,
  type AccountStatus,
  type MarketAccount,
  type MarketNode,
  NODE_STATUS_OPTIONS,
  validatePrice,
  WINDOW_OPTIONS,
} from "./catalog"

type AccountOfferDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (record: MarketAccount) => void
  readonly record: MarketAccount
}

type NodeOfferDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (record: MarketNode) => void
  readonly record: MarketNode
}

const OfferFooter = ({
  onCancel,
  onSubmit,
}: {
  readonly onCancel: () => void
  readonly onSubmit: () => void
}): ReactNode => (
  <div className="dialog-footer">
    <Button onClick={onCancel} type="text">
      取消
    </Button>
    <Button onClick={onSubmit} type="primary">
      确认
    </Button>
  </div>
)

export const AccountOfferDialog = ({
  onCancel,
  onSubmit,
  record,
}: AccountOfferDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [price, setPrice] = useState(record.price)
  const [status, setStatus] = useState<AccountStatus>(record.status)
  const [windowed, setWindowed] = useState(record.windowed)

  const submit = (): void => {
    const error = validatePrice(price)
    if (error !== null) {
      message.error(error)
      return
    }
    onSubmit({ ...record, price, status, windowed })
  }

  return (
    <Modal
      footer={<OfferFooter onCancel={onCancel} onSubmit={submit} />}
      onCancel={onCancel}
      open
      title="更新"
    >
      <Typography.Paragraph className="muted" type="secondary">
        货号、粉丝量、地区、运营员由账号表同步，此处只维护开窗、价格和状态。
      </Typography.Paragraph>
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="开窗" required>
          <Select
            aria-label="开窗"
            onChange={(value) => setWindowed(value === "yes")}
            options={[...WINDOW_OPTIONS]}
            style={{ width: 200 }}
            value={windowed ? "yes" : "no"}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="价格" required>
          <InputNumber
            aria-label="价格"
            min={0}
            onChange={(value) => setPrice(value ?? Number.NaN)}
            style={{ width: 200 }}
            value={Number.isFinite(price) ? price : null}
          />
        </Form.Item>
        <Form.Item label="状态" required>
          <Select
            aria-label="状态"
            onChange={setStatus}
            options={[...ACCOUNT_STATUS_OPTIONS]}
            style={{ width: 200 }}
            value={status}
            virtual={false}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const NodeOfferDialog = ({
  onCancel,
  onSubmit,
  record,
}: NodeOfferDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [price, setPrice] = useState(record.price)
  const [status, setStatus] = useState<MarketNode["status"]>(record.status)

  const submit = (): void => {
    const error = validatePrice(price)
    if (error !== null) {
      message.error(error)
      return
    }
    onSubmit({ ...record, price, status })
  }

  return (
    <Modal
      footer={<OfferFooter onCancel={onCancel} onSubmit={submit} />}
      onCancel={onCancel}
      open
      title="更新"
    >
      <Typography.Paragraph className="muted" type="secondary">
        名称、地区、带宽由节点表同步，此处只维护价格和状态。
      </Typography.Paragraph>
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="价格" required>
          <InputNumber
            aria-label="价格"
            min={0}
            onChange={(value) => setPrice(value ?? Number.NaN)}
            style={{ width: 200 }}
            value={Number.isFinite(price) ? price : null}
          />
        </Form.Item>
        <Form.Item label="状态" required>
          <Select
            aria-label="状态"
            onChange={setStatus}
            options={[...NODE_STATUS_OPTIONS]}
            style={{ width: 200 }}
            value={status}
            virtual={false}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

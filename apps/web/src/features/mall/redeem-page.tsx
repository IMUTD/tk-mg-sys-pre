import {
  App,
  Button,
  Card,
  InputNumber,
  Modal,
  Table,
  type TableColumnsType,
  Typography,
} from "antd"
import { type ReactNode, useState } from "react"

import "./mall.css"

type OfferKind = "账号" | "代理"

type Offer = {
  readonly detail: string
  readonly id: string
  readonly kind: OfferKind
  readonly name: string
  readonly price: number
  stock: number
}

const STARTING_OFFERS: readonly Offer[] = [
  {
    detail: "100 个起售",
    id: "account-jp",
    kind: "账号",
    name: "日本满季度白号",
    price: 50,
    stock: 100,
  },
  {
    detail: "50 个起售",
    id: "account-us",
    kind: "账号",
    name: "美区新注册号",
    price: 30,
    stock: 80,
  },
  {
    detail: "20 个起售",
    id: "account-mail",
    kind: "账号",
    name: "邮箱验证号",
    price: 80,
    stock: 20,
  },
  {
    detail: "200G / 30 天",
    id: "proxy-global",
    kind: "代理",
    name: "全球动态住宅",
    price: 200,
    stock: 12,
  },
  {
    detail: "1 条 / 30 天",
    id: "proxy-us",
    kind: "代理",
    name: "美国静态住宅",
    price: 80,
    stock: 30,
  },
  {
    detail: "5 条 / 30 天",
    id: "proxy-jp",
    kind: "代理",
    name: "日本机房代理",
    price: 40,
    stock: 18,
  },
]

const money = (value: number): string => `¥${value.toLocaleString("zh-CN")}`

export const MallRedeemPage = (): ReactNode => {
  const { message } = App.useApp()
  const [offers, setOffers] = useState<Offer[]>(() => STARTING_OFFERS.map((item) => ({ ...item })))
  const [buying, setBuying] = useState<Offer | null>(null)
  const [count, setCount] = useState(1)

  const openBuy = (offer: Offer): void => {
    setBuying(offer)
    setCount(1)
  }

  const confirmBuy = (): void => {
    if (buying === null) return
    const next = Math.min(Math.max(1, count), buying.stock)
    setOffers((current) =>
      current.map((item) => (item.id === buying.id ? { ...item, stock: item.stock - next } : item)),
    )
    setBuying(null)
    message.success("购买已提交，等待商家发货")
  }

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Typography.Text type="secondary">积分余额</Typography.Text>
        <div className="purchase-balance">59,900</div>
      </Card>
      <div className="purchase-grid">
        <OfferCard kind="账号" offers={offers} onBuy={openBuy} title="购买账号" />
        <OfferCard kind="代理" offers={offers} onBuy={openBuy} title="购买代理" />
      </div>
      <Modal
        cancelText="取消"
        okButtonProps={{ disabled: buying === null || buying.stock < 1 }}
        okText="确认购买"
        onCancel={() => setBuying(null)}
        onOk={confirmBuy}
        open={buying !== null}
        title={buying === null ? "购买" : `购买${buying.kind}`}
      >
        {buying === null ? null : (
          <div className="purchase-form">
            <div>
              <span>商品</span>
              <strong>{buying.name}</strong>
            </div>
            <div>
              <span>单价</span>
              <strong>{money(buying.price)}</strong>
            </div>
            <div>
              <span>数量</span>
              <InputNumber
                aria-label="购买数量"
                max={buying.stock}
                min={1}
                onChange={(value) => setCount(value ?? 1)}
                value={count}
              />
            </div>
            <div>
              <span>合计</span>
              <strong>{money(buying.price * count)}</strong>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}

const OfferCard = ({
  kind,
  offers,
  onBuy,
  title,
}: {
  readonly kind: OfferKind
  readonly offers: readonly Offer[]
  readonly onBuy: (offer: Offer) => void
  readonly title: string
}): ReactNode => {
  const columns: TableColumnsType<Offer> = [
    { dataIndex: "name", title: "商品" },
    { dataIndex: "detail", title: "规格" },
    { dataIndex: "price", render: (value: number) => money(value), title: "单价", width: 90 },
    { dataIndex: "stock", title: "库存", width: 70 },
    {
      render: (_value, offer) => (
        <Button
          aria-label={`购买${offer.name}`}
          disabled={offer.stock < 1}
          onClick={() => onBuy(offer)}
          size="small"
          type="primary"
        >
          购买
        </Button>
      ),
      title: "操作",
      width: 80,
    },
  ]
  return (
    <Card size="small" title={title}>
      <Table
        columns={columns}
        dataSource={offers.filter((item) => item.kind === kind)}
        pagination={false}
        rowKey="id"
        size="small"
      />
    </Card>
  )
}

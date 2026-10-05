import { App, Button, Card, Space, Statistic, Tag, Typography } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import { createSeedPoints, createSeedProducts, pointBalance, type RedeemProduct } from "./catalog"
import "./mall.css"

export const MallRedeemPage = (): ReactNode => {
  const { message } = App.useApp()
  const [tag, setTag] = useState("")
  const products = useMemo(() => createSeedProducts(), [])
  const tags = [...new Set(products.map((item) => item.tag))]
  const rows = tag.length === 0 ? products : products.filter((item) => item.tag === tag)
  const balance = pointBalance(createSeedPoints())

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space className="mall-kpi-row" wrap>
          <Statistic title="积分余额" value={balance} />
          <Button type="primary">充值</Button>
        </Space>
      </Card>
      <Space wrap>
        <Button onClick={() => setTag("")} type={tag.length === 0 ? "primary" : "default"}>
          全部
        </Button>
        {tags.map((item) => (
          <Button
            key={item}
            onClick={() => setTag(item)}
            type={tag === item ? "primary" : "default"}
          >
            {item}
          </Button>
        ))}
      </Space>
      <div className="redeem-grid">
        {rows.map((item) => (
          <ProductCard key={item.id} onRedeem={() => message.success("兑换成功")} product={item} />
        ))}
      </div>
    </section>
  )
}

const ProductCard = ({
  onRedeem,
  product,
}: {
  readonly onRedeem: () => void
  readonly product: RedeemProduct
}): ReactNode => (
  <Card extra={<Tag color="gold">{product.points} 积分</Tag>} title={product.name}>
    <div className="redeem-card-meta">
      <span>{product.stockLabel}</span>
      <span>限购{product.limit}件</span>
    </div>
    <Typography.Paragraph type="secondary">{product.tag}</Typography.Paragraph>
    <Button onClick={onRedeem} type="primary">
      立即兑换
    </Button>
  </Card>
)

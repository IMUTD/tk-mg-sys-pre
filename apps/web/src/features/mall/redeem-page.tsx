import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Modal,
  Table,
  type TableColumnsType,
  Typography,
} from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { createMallApi, type MallApi, type MallProduct, mallRequestError } from "./api"
import { type ProductKind, pointsText } from "./catalog"
import { MallGroupBar, useMallGroup } from "./group-wallet"
import "./mall.css"

const defaultApi = createMallApi()

const canBuy = (product: MallProduct): boolean => product.stock >= product.minQuantity

export const MallRedeemPage = ({ api = defaultApi }: { readonly api?: MallApi }): ReactNode => {
  const group = useMallGroup(api)
  const products = useQuery({ queryFn: () => api.products(), queryKey: ["mall", "products"] })
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const rows = products.data ?? []
  const buying = rows.find((item) => item.id === buyingId) ?? null

  return (
    <section className="module-page mall-page">
      <MallGroupBar state={group} />
      <Card size="small">
        <Typography.Text type="secondary">积分余额</Typography.Text>
        <div className="purchase-balance">
          {group.selected === null ? "-" : group.selected.balance.toLocaleString("zh-CN")}
        </div>
      </Card>
      {products.isError ? <Alert title="商品加载失败，请稍后重试" type="error" /> : null}
      <div className="purchase-grid">
        <OfferCard
          kind="account"
          loading={products.isPending}
          onBuy={setBuyingId}
          rows={rows}
          title="购买账号"
        />
        <OfferCard
          kind="proxy"
          loading={products.isPending}
          onBuy={setBuyingId}
          rows={rows}
          title="购买代理"
        />
      </div>
      {buyingId !== null && buying !== null && group.selected !== null ? (
        <PurchaseDialog
          api={api}
          balance={group.selected.balance}
          groupId={group.selected.groupId}
          key={buyingId}
          onClose={() => setBuyingId(null)}
          product={buying}
        />
      ) : null}
    </section>
  )
}

const PurchaseDialog = ({
  api,
  balance,
  groupId,
  onClose,
  product,
}: {
  readonly api: MallApi
  readonly balance: number
  readonly groupId: string
  readonly onClose: () => void
  readonly product: MallProduct
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  // 弹窗打开期间固定一个幂等键：网络失败后重试不会重复扣积分。
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [quantity, setQuantity] = useState(product.minQuantity)
  const refresh = () => client.invalidateQueries({ queryKey: ["mall"] })
  const mutation = useMutation({
    mutationFn: () =>
      api.purchase(groupId, {
        expectedUnitPoints: product.pricePoints,
        idempotencyKey,
        productId: product.id,
        quantity,
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      await refresh()
    },
    onSuccess: async () => {
      message.success("购买已提交，等待商家发货")
      onClose()
      await refresh()
    },
  })

  // 重新加载后库存可能变少，已选数量不能超过当前库存。
  useEffect(() => {
    setQuantity((current) =>
      Math.max(product.minQuantity, Math.min(current, Math.max(product.stock, 1))),
    )
  }, [product.minQuantity, product.stock])

  const total = product.pricePoints * quantity
  const insufficient = total > balance
  const available = canBuy(product) && quantity <= product.stock

  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: insufficient || !available }}
      okText="确认购买"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title={`购买${product.kind === "account" ? "账号" : "代理"}`}
    >
      <div className="purchase-form">
        <div>
          <span>商品</span>
          <strong>{product.name}</strong>
        </div>
        <div>
          <span>单价</span>
          <strong>{pointsText(product.pricePoints)}</strong>
        </div>
        <div>
          <span>数量</span>
          <InputNumber
            aria-label="购买数量"
            max={Math.max(product.stock, product.minQuantity)}
            min={product.minQuantity}
            onChange={(value) => setQuantity(value ?? product.minQuantity)}
            precision={0}
            value={quantity}
          />
        </div>
        <div>
          <span>合计</span>
          <strong>{pointsText(total)}</strong>
        </div>
        <div>
          <span>购买后余额</span>
          <strong>{insufficient ? "-" : pointsText(balance - total)}</strong>
        </div>
        {insufficient ? <Alert title="积分余额不足" type="warning" /> : null}
        {canBuy(product) ? null : <Alert title="库存不足" type="warning" />}
      </div>
    </Modal>
  )
}

const OfferCard = ({
  kind,
  loading,
  onBuy,
  rows,
  title,
}: {
  readonly kind: ProductKind
  readonly loading: boolean
  readonly onBuy: (productId: string) => void
  readonly rows: readonly MallProduct[]
  readonly title: string
}): ReactNode => {
  const columns: TableColumnsType<MallProduct> = [
    { dataIndex: "name", title: "商品" },
    { dataIndex: "spec", title: "规格" },
    {
      dataIndex: "pricePoints",
      render: (value: number) => pointsText(value),
      title: "单价",
      width: 130,
    },
    { dataIndex: "stock", title: "库存", width: 70 },
    {
      render: (_value, product) => (
        <Button
          aria-label={`购买${product.name}`}
          disabled={!canBuy(product)}
          onClick={() => onBuy(product.id)}
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
        dataSource={rows.filter((item) => item.kind === kind)}
        loading={loading}
        pagination={false}
        rowKey="id"
        size="small"
      />
    </Card>
  )
}

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
  Select,
  Space,
  Switch,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useState } from "react"

import { type MallProduct, mallRequestError } from "../mall/api"
import {
  PRODUCT_KIND_OPTIONS,
  type ProductKind,
  pointsText,
  productKindLabel,
} from "../mall/catalog"
import { createMerchantApi, type MerchantApi } from "./api"
import { GroupPicker, type PickedGroup } from "./group-picker"
import "../mall/mall.css"

const defaultApi = createMerchantApi()
const PAGE_SIZE = 20

type Editing =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly product: MallProduct }

export const MerchantProductsPage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [keyword, setKeyword] = useState("")
  const [appliedKeyword, setAppliedKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Editing | null>(null)
  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(appliedKeyword.length > 0 ? { keyword: appliedKeyword } : {}),
  }
  const products = useQuery({
    queryFn: () => api.products(query),
    queryKey: ["merchant", "products", query],
  })
  const toggle = useMutation({
    mutationFn: (product: MallProduct) =>
      api.updateProduct(product.id, { enabled: !product.enabled }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
    },
    onSuccess: async (product) => {
      message.success(product.enabled ? "已上架" : "已下架")
      await client.invalidateQueries({ queryKey: ["merchant", "products"] })
      await client.invalidateQueries({ queryKey: ["mall", "products"] })
    },
  })

  const columns: TableColumnsType<MallProduct> = [
    {
      dataIndex: "kind",
      render: (value: ProductKind) => productKindLabel(value),
      title: "类型",
      width: 80,
    },
    { dataIndex: "name", title: "商品" },
    { dataIndex: "spec", title: "规格" },
    {
      dataIndex: "pricePoints",
      render: (value: number) => pointsText(value),
      title: "单价",
      width: 140,
    },
    { dataIndex: "minQuantity", title: "起售", width: 70 },
    { dataIndex: "stock", title: "库存", width: 90 },
    {
      render: (_value, product) =>
        product.available === null || product.available === undefined ? (
          <span className="muted">未绑定</span>
        ) : (
          <Space size={4}>
            <span>
              {product.inventoryGroupName}：{Math.max(product.available, 0)}
            </span>
            {product.available < product.stock ? <Tag color="warning">不足</Tag> : null}
          </Space>
        ),
      title: "库存分组可发",
      width: 200,
    },
    {
      dataIndex: "enabled",
      render: (value: boolean) => (
        <Tag color={value ? "success" : "default"}>{value ? "上架中" : "已下架"}</Tag>
      ),
      title: "状态",
      width: 90,
    },
    {
      render: (_value, product) => (
        <Space>
          <Button
            aria-label={`编辑${product.name}`}
            onClick={() => setEditing({ kind: "edit", product })}
            size="small"
          >
            编辑
          </Button>
          <Button
            aria-label={`${product.enabled ? "下架" : "上架"}${product.name}`}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(product)}
            size="small"
          >
            {product.enabled ? "下架" : "上架"}
          </Button>
        </Space>
      ),
      title: "操作",
      width: 150,
    },
  ]

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            aria-label="商品名称"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="商品名称"
            style={{ width: 220 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              setPage(1)
              setAppliedKeyword(keyword.trim())
            }}
            type="primary"
          >
            搜索
          </Button>
          <Button onClick={() => setEditing({ kind: "create" })} type="primary">
            新增商品
          </Button>
        </Space>
      </Card>
      {products.isError ? <Alert title="商品加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(products.data?.items ?? [])]}
        loading={products.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: products.data?.total ?? 0,
        }}
        rowKey="id"
        size="small"
      />
      {editing === null ? null : (
        <ProductDialog
          api={api}
          onClose={() => setEditing(null)}
          product={editing.kind === "edit" ? editing.product : null}
        />
      )}
    </section>
  )
}

const ProductDialog = ({
  api,
  onClose,
  product,
}: {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly product: MallProduct | null
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? "account")
  const [name, setName] = useState(product?.name ?? "")
  const [spec, setSpec] = useState(product?.spec ?? "")
  const [pricePoints, setPricePoints] = useState<number | null>(product?.pricePoints ?? null)
  const [minQuantity, setMinQuantity] = useState<number | null>(product?.minQuantity ?? 1)
  const [stock, setStock] = useState<number | null>(0)
  const [enabled, setEnabled] = useState(product?.enabled ?? true)
  const [inventory, setInventory] = useState<PickedGroup | null>(
    product?.inventoryGroupId === null || product?.inventoryGroupId === undefined
      ? null
      : { groupId: product.inventoryGroupId, name: product.inventoryGroupName ?? "" },
  )
  const isEdit = product !== null

  const mutation = useMutation({
    mutationFn: async () => {
      const common = {
        enabled,
        inventoryGroupId: inventory?.groupId ?? null,
        minQuantity: minQuantity ?? 1,
        name: name.trim(),
        pricePoints: pricePoints ?? 0,
        spec: spec.trim(),
      }
      if (isEdit) {
        await api.updateProduct(product.id, {
          ...common,
          ...(stock === null || stock === 0 ? {} : { stockDelta: stock }),
        })
        return
      }
      await api.createProduct({ ...common, kind, stock: stock ?? 0 })
    },
    onError: async (error) => {
      message.error(await mallRequestError(error))
    },
    onSuccess: async () => {
      message.success(isEdit ? "商品已保存" : "商品已新增")
      onClose()
      await client.invalidateQueries({ queryKey: ["merchant", "products"] })
      await client.invalidateQueries({ queryKey: ["mall", "products"] })
    },
  })
  const invalid =
    name.trim().length === 0 || pricePoints === null || pricePoints <= 0 || minQuantity === null

  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: invalid }}
      okText="保存"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title={isEdit ? "编辑商品" : "新增商品"}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="类型" required>
          <Select
            aria-label="类型"
            disabled={isEdit}
            onChange={setKind}
            options={[...PRODUCT_KIND_OPTIONS]}
            style={{ width: 220 }}
            value={kind}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="商品名称" required>
          <Input
            aria-label="商品名称"
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Form.Item>
        <Form.Item
          extra="绑定后只能从这个分组发货，可售数量也不会超过分组里实际能发的数量"
          label="库存分组"
        >
          <GroupPicker api={api} label="库存分组" onChange={setInventory} value={inventory} />
        </Form.Item>
        <Form.Item label="规格">
          <Input
            aria-label="规格"
            maxLength={200}
            onChange={(event) => setSpec(event.target.value)}
            value={spec}
          />
        </Form.Item>
        <Form.Item label="单价" required>
          <InputNumber
            aria-label="单价"
            min={1}
            onChange={setPricePoints}
            precision={0}
            style={{ width: 220 }}
            suffix="积分"
            value={pricePoints}
          />
        </Form.Item>
        <Form.Item label="起售数量" required>
          <InputNumber
            aria-label="起售数量"
            max={1000}
            min={1}
            onChange={setMinQuantity}
            precision={0}
            style={{ width: 220 }}
            value={minQuantity}
          />
        </Form.Item>
        {isEdit ? (
          <Form.Item extra={`当前库存 ${product.stock}，正数补货，负数减少`} label="库存增减">
            <InputNumber
              aria-label="库存增减"
              onChange={setStock}
              precision={0}
              style={{ width: 220 }}
              value={stock}
            />
          </Form.Item>
        ) : (
          <Form.Item label="初始库存">
            <InputNumber
              aria-label="初始库存"
              min={0}
              onChange={setStock}
              precision={0}
              style={{ width: 220 }}
              value={stock}
            />
          </Form.Item>
        )}
        <Form.Item label="上架">
          <Switch aria-label="上架" checked={enabled} onChange={setEnabled} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

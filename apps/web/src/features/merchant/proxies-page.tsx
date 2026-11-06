import type { TableColumnsType } from "antd"
import type { ReactNode } from "react"

import { TransferPage } from "./transfer-page"

type ProxyRow = {
  address: string
  group: string
  id: string
  name: string
  owner: string
}

const ROWS: readonly ProxyRow[] = [
  { address: "tokyo-01.proxy", group: "住宅", id: "p1", name: "东京住宅-01", owner: "当前管理员" },
  { address: "us-03.proxy", group: "静态", id: "p2", name: "美国静态-03", owner: "当前管理员" },
  { address: "global-12.proxy", group: "动态", id: "p3", name: "全球动态-12", owner: "一组管理员" },
  {
    address: "jp-room-07.proxy",
    group: "机房",
    id: "p4",
    name: "日本机房-07",
    owner: "当前管理员",
  },
]

const columns: TableColumnsType<ProxyRow> = [
  { dataIndex: "name", title: "名字" },
  { dataIndex: "address", title: "地址" },
  { dataIndex: "group", title: "分组" },
  { dataIndex: "owner", title: "所属管理员" },
]

export const ProxyTransferPage = (): ReactNode => (
  <TransferPage columns={columns} noun="代理" rows={ROWS} />
)

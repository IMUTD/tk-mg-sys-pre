import type { TableColumnsType } from "antd"
import type { ReactNode } from "react"

import { TransferPage } from "./transfer-page"

type AccountRow = {
  group: string
  id: string
  name: string
  owner: string
  tags: string
}

const ROWS: readonly AccountRow[] = [
  { group: "一组", id: "a1", name: "jp_white_001", owner: "当前管理员", tags: "测试标签1" },
  { group: "一组", id: "a2", name: "jp_white_002", owner: "当前管理员", tags: "测试标签1" },
  { group: "邮箱验证", id: "a3", name: "mail_verify_014", owner: "当前管理员", tags: "邮箱验证" },
  { group: "测试分组", id: "a4", name: "us_new_008", owner: "二组管理员", tags: "测试标签2" },
]

const columns: TableColumnsType<AccountRow> = [
  { dataIndex: "name", title: "账号" },
  { dataIndex: "group", title: "分组" },
  { dataIndex: "tags", title: "标签" },
  { dataIndex: "owner", title: "所属管理员" },
]

export const AccountTransferPage = (): ReactNode => (
  <TransferPage columns={columns} noun="账号" rows={ROWS} />
)

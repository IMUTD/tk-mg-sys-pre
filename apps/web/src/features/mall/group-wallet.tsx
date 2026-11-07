import { useQuery } from "@tanstack/react-query"
import { Alert, Select } from "antd"
import { type ReactNode, useState } from "react"

import type { GroupWallet, MallApi } from "./api"

export type MallGroupState = {
  readonly errored: boolean
  readonly loading: boolean
  readonly select: (groupId: string) => void
  readonly selected: GroupWallet | null
  readonly wallets: readonly GroupWallet[]
}

export const useMallGroup = (api: MallApi): MallGroupState => {
  const [groupId, setGroupId] = useState<string | null>(null)
  const query = useQuery({ queryFn: () => api.wallets(), queryKey: ["mall", "wallets"] })
  const wallets = query.data ?? []
  return {
    errored: query.isError,
    loading: query.isPending,
    select: setGroupId,
    selected: wallets.find((item) => item.groupId === groupId) ?? wallets[0] ?? null,
    wallets,
  }
}

/** 只属于一个分组时不显示选择器；没有分组或加载失败时给出明确提示。 */
export const MallGroupBar = ({ state }: { readonly state: MallGroupState }): ReactNode => {
  if (state.errored) return <Alert title="积分数据加载失败，请刷新后重试" type="error" />
  if (state.loading) return null
  if (state.wallets.length === 0) {
    return <Alert title="当前账号没有加入任何分组，无法使用积分" type="info" />
  }
  if (state.wallets.length === 1) return null
  return (
    <Select
      aria-label="分组"
      onChange={state.select}
      options={state.wallets.map((item) => ({ label: item.name, value: item.groupId }))}
      style={{ width: 220 }}
      value={state.selected?.groupId ?? null}
      virtual={false}
    />
  )
}

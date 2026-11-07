import { useQuery } from "@tanstack/react-query"
import { Select } from "antd"
import { type ReactNode, useState } from "react"

import type { MerchantApi } from "./api"

const SEARCH_PAGE_SIZE = 100

export type PickedGroup = { readonly groupId: string; readonly name: string }

/** 分组可能很多，这里每次只取前 100 个，搜索交给服务端。 */
export const GroupPicker = ({
  api,
  excludeGroupId,
  label,
  onChange,
  value,
}: {
  readonly api: MerchantApi
  readonly excludeGroupId?: string | undefined
  readonly label: string
  readonly onChange: (group: PickedGroup | null) => void
  readonly value: PickedGroup | null
}): ReactNode => {
  const [keyword, setKeyword] = useState("")
  const query = {
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    ...(keyword.length > 0 ? { keyword } : {}),
  }
  const groups = useQuery({
    queryFn: () => api.wallets(query),
    queryKey: ["merchant", "wallets", query],
  })
  const options = (groups.data?.items ?? [])
    .filter((group) => group.groupId !== excludeGroupId)
    .map((group) => ({ label: group.name, value: group.groupId }))
  const selected = value === null ? null : { label: value.name, value: value.groupId }

  return (
    <Select
      allowClear
      aria-label={label}
      labelInValue
      loading={groups.isFetching}
      onChange={(next: { label: ReactNode; value: string } | undefined) => {
        setKeyword("")
        onChange(
          next === undefined ? null : { groupId: next.value, name: String(next.label ?? "") },
        )
      }}
      options={options}
      placeholder={label}
      showSearch={{ filterOption: false, onSearch: (text) => setKeyword(text.trim()) }}
      style={{ width: 200 }}
      value={selected}
      virtual={false}
    />
  )
}

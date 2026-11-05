import { Button, Input, Space, Statistic, Table, Typography } from "antd"
import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "../../lib/api/api-fetch"

type FeeRow = {
  readonly amount: string
  readonly boxId: string
  readonly createdAt: string
  readonly host: string
  readonly id: string
  readonly name: string
  readonly note: string
  readonly ownerEmail?: string
  readonly ownerName?: string
}

type FeeList = {
  readonly available: boolean
  readonly fees: readonly FeeRow[]
  readonly scope: "all" | "own"
  readonly summary: {
    readonly amount: string
    readonly count: number
  }
  readonly total: number
}

const formatTime = (value: string): string => {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return "—"
  return time.toLocaleString("zh-CN", { hour12: false })
}

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "请求失败"
}

export const BoxFeesPanel = () => {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ from: "", keyword: "", to: "" })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [list, setList] = useState<FeeList | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (applied.from !== "") params.set("from", applied.from)
    if (applied.to !== "") params.set("to", applied.to)
    if (applied.keyword !== "") params.set("q", applied.keyword)
    const response = await apiFetch(`/api/box-service/fees?${params.toString()}`, {
      credentials: "include",
    })
    setLoading(false)
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    setList((await response.json()) as FeeList)
    setError("")
  }, [applied, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const search = () => {
    setPage(1)
    setApplied({ from, keyword: keyword.trim(), to })
  }

  const scope = list?.scope ?? "own"

  return (
    <>
      <Typography.Paragraph type="secondary">
        费用在 init-tool 里按盒子录入，归到盒子当前分给的管理员。
        {scope === "all" ? "系统账号查看全部费用。" : "这里只显示你和你下级名下盒子的费用。"}
      </Typography.Paragraph>
      {list !== null && !list.available ? (
        <Typography.Paragraph type="warning">数据库里还没有费用记录表。</Typography.Paragraph>
      ) : null}
      <div style={{ display: "flex", gap: 32, marginBottom: 16 }}>
        <Statistic prefix="¥" title="费用合计" value={list?.summary.amount ?? "0.00"} />
        <Statistic title="记录笔数" value={list?.summary.count ?? 0} />
      </div>
      <Space wrap style={{ display: "flex", marginBottom: 16 }}>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Input
          allowClear
          placeholder={scope === "all" ? "设备 ID、备注、管理员" : "设备 ID、备注"}
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={search}
        />
        <Button type="primary" onClick={search}>
          查询
        </Button>
      </Space>
      {error !== "" ? <Typography.Paragraph type="danger">{error}</Typography.Paragraph> : null}
      <Table<FeeRow>
        rowKey="id"
        loading={loading}
        scroll={{ x: 960 }}
        dataSource={[...(list?.fees ?? [])]}
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          total: list?.total ?? 0,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage)
            setPageSize(nextSize)
          },
        }}
        columns={[
          {
            title: "记录时间",
            dataIndex: "createdAt",
            render: (value: string) => formatTime(value),
            width: 180,
          },
          ...(scope === "all"
            ? [
                {
                  title: "管理员",
                  render: (_value: unknown, row: FeeRow) =>
                    row.ownerName || row.ownerEmail || "未分配",
                },
              ]
            : []),
          { title: "设备 ID", dataIndex: "boxId" },
          { title: "名称", dataIndex: "name" },
          {
            title: "金额",
            dataIndex: "amount",
            render: (value: string) => `¥${value}`,
            width: 100,
          },
          { title: "备注", dataIndex: "note" },
        ]}
      />
    </>
  )
}

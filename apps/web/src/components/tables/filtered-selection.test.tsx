import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Table } from "antd"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { toggleFilteredKeys, useFilteredRowSelection } from "./filtered-selection"

describe("filtered selection", () => {
  it("selects every filtered key and clears that set on the next toggle", () => {
    expect(toggleFilteredKeys([2], [1, 2, 3])).toEqual([2, 1, 3])
    expect(toggleFilteredKeys([1, 2, 3, 9], [1, 2, 3])).toEqual([9])
  })

  it("checks every page of the current rows from the header checkbox", async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `第${index + 1}行`,
    }))
    const Harness = () => {
      const [selected, setSelected] = useState<readonly number[]>([])
      const rowSelection = useFilteredRowSelection({
        onChange: (keys) => setSelected(keys.map((key) => Number(key))),
        rowKey: "id",
        rows,
        selectedKeys: selected,
      })
      return (
        <>
          <span>已选 {selected.length}</span>
          <Table
            columns={[{ dataIndex: "name", title: "名称" }]}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            rowKey="id"
            rowSelection={rowSelection}
          />
        </>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    expect(screen.getByText("已选 25")).toBeVisible()

    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    expect(screen.getByText("已选 0")).toBeVisible()
  })

  it("selects only the current page when the scope is the page", async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `第${index + 1}行`,
    }))
    const Harness = () => {
      const [selected, setSelected] = useState<readonly number[]>([])
      const rowSelection = useFilteredRowSelection({
        onChange: (keys) => setSelected(keys.map((key) => Number(key))),
        pageKeys: rows.slice(0, 10).map((row) => row.id),
        rowKey: "id",
        rows,
        selectedKeys: selected,
        selectionScope: "page",
      })
      return (
        <>
          <span>已选 {selected.length}</span>
          <Table
            columns={[{ dataIndex: "name", title: "名称" }]}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            rowKey="id"
            rowSelection={rowSelection}
          />
        </>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    expect(screen.getByText("已选 10")).toBeVisible()
  })
})

import { App, Button, Card, Form, Input, Modal, Select } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { useChains } from "./chain-store"
import { type ChainStep, stepText } from "./rpa-api"

type TaskChainStep = ChainStep

type TaskChainStage = {
  readonly chainId: string
  readonly chainName: string
  readonly position: number
  readonly steps: readonly TaskChainStep[]
}

type TaskChain = {
  readonly id: string
  readonly name: string
  readonly stages: readonly TaskChainStage[]
  readonly updatedAt: string
}

type DraftRow = { readonly chainId: string; readonly key: string }

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  if (body?.error === "task_chain_in_use") return "这条任务链已被任务使用，不能删除"
  if (response.status === 400) return "请检查任务链"
  return "保存失败"
}

const loadTaskChains = async (): Promise<TaskChain[]> => {
  const response = await fetch("/api/task-chains", { credentials: "same-origin" })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as TaskChain[]
}

const stageSummary = (steps: readonly TaskChainStep[]): string => {
  const first = steps[0]
  if (first === undefined) return "没有步骤"
  const text = stepText(first)
  return steps.length === 1 ? text : `${text} · 等 ${steps.length} 步`
}

const saveTaskChain = async (name: string, rows: readonly DraftRow[], id?: string): Promise<void> => {
  const response = await fetch(id === undefined ? "/api/task-chains" : `/api/task-chains/${id}`, {
    body: JSON.stringify({ name, stages: rows.map((row) => ({ chainId: row.chainId })) }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: id === undefined ? "POST" : "PUT",
  })
  if (!response.ok) throw new Error(await readError(response))
}

export const TaskChainList = ({ canDelete, canWrite }: {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}): ReactNode => {
  const { message, modal } = App.useApp()
  const chains = useChains()
  const [items, setItems] = useState<TaskChain[]>([])
  const [editing, setEditing] = useState<TaskChain | null | "new">(null)
  const [name, setName] = useState("")
  const [rows, setRows] = useState<DraftRow[]>([])
  const [pick, setPick] = useState<string | null>(null)

  const refresh = (): void => {
    void loadTaskChains()
      .then(setItems)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }

  useEffect(() => {
    refresh()
  }, [])

  const open = (item: TaskChain | "new"): void => {
    setEditing(item === "new" ? "new" : item)
    setName(item === "new" ? "" : item.name)
    setRows(
      item === "new"
        ? []
        : item.stages.map((stage) => ({ chainId: stage.chainId, key: `${stage.position}-${stage.chainId}` })),
    )
    setPick(null)
  }

  const move = (index: number, delta: number): void => {
    setRows((current) => {
      const next = [...current]
      const target = index + delta
      const row = next[index]
      const other = next[target]
      if (row === undefined || other === undefined) return current
      next[index] = other
      next[target] = row
      return next
    })
  }

  const save = (): void => {
    if (name.trim().length === 0) {
      message.error("请填写任务链名称")
      return
    }
    if (rows.length === 0) {
      message.error("请添加行为链")
      return
    }
    const id = editing !== null && editing !== "new" ? editing.id : undefined
    void saveTaskChain(name, rows, id)
      .then(() => {
        setEditing(null)
        refresh()
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }

  return (
    <div className="behaviors-pane">
      <div className="behaviors-toolbar">
        {canWrite ? (
          <Button onClick={() => open("new")} type="primary">
            新建任务链
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <Card className="behaviors-empty">暂无任务链</Card>
      ) : (
        <div className="behaviors-card-grid">
          {items.map((item) => (
            <Card
              extra={
                <>
                  {canWrite ? (
                    <Button onClick={() => open(item)} size="small" type="link">
                      编辑
                    </Button>
                  ) : null}
                  {canDelete === true ? (
                    <Button
                      danger
                      onClick={() => {
                        void modal.confirm({
                          cancelText: "取消",
                          content: `确定删除「${item.name}」吗？删除后无法恢复。`,
                          okText: "确定",
                          onOk: async () => {
                            const response = await fetch(`/api/task-chains/${item.id}`, {
                              credentials: "same-origin",
                              method: "DELETE",
                            })
                            if (response.status === 409) {
                              message.error("这条任务链已被任务使用，不能删除")
                              return
                            }
                            if (!response.ok) {
                              message.error("删除失败")
                              return
                            }
                            message.success("删除成功")
                            refresh()
                          },
                          title: "提示",
                        })
                      }}
                      size="small"
                      type="link"
                    >
                      删除
                    </Button>
                  ) : null}
                </>
              }
              key={item.id}
              title={item.name}
            >
              <p>{item.stages.map((stage) => stage.chainName).join(" → ")}</p>
              <ol className="chain-steps">
                {item.stages
                  .flatMap((stage) => stage.steps.map((step) => ({ name: stage.chainName, step })))
                  .slice(0, 4)
                  .map((entry, index) => {
                    const text = `${entry.name} · ${stepText(entry.step)}`
                    return (
                      <li key={`${item.id}-${index}`} title={text}>
                        {text}
                      </li>
                    )
                  })}
              </ol>
            </Card>
          ))}
        </div>
      )}
      <Modal
        footer={
          <div className="dialog-footer">
            <Button onClick={() => setEditing(null)} type="text">
              取消
            </Button>
            <Button onClick={save} type="primary">
              保存
            </Button>
          </div>
        }
        onCancel={() => setEditing(null)}
        open={editing !== null}
        title={editing === "new" ? "新建任务链" : "编辑任务链"}
        width={840}
      >
        <Form labelCol={{ style: { width: 88 } }} layout="horizontal" size="small">
          <Form.Item label="名称" required>
            <Input
              aria-label="任务链名称"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Form.Item>
          <Form.Item label="添加行为链">
            <Select
              aria-label="添加行为链"
              onChange={(value: string) => {
                setRows((current) => [
                  ...current,
                  { chainId: value, key: `${value}-${current.length}-${Date.now()}` },
                ])
                setPick(null)
              }}
              options={chains.map((item) => ({ label: item.name, value: item.id }))}
              placeholder="选择行为链"
              value={pick}
              virtual={false}
            />
          </Form.Item>
        </Form>
        {rows.length === 0 ? (
          <div className="task-chain-editor-empty">尚未添加行为链</div>
        ) : (
          <ol className="task-chain-stage-list">
            {rows.map((row, index) => {
              const chain = chains.find((item) => item.id === row.chainId)
              return (
                <li className="task-chain-stage" key={row.key}>
                  <span className="task-chain-stage-index">{index + 1}</span>
                  <div className="task-chain-stage-body">
                    <div className="task-chain-stage-name">{chain?.name ?? "行为链"}</div>
                    <div className="task-chain-stage-summary">{stageSummary(chain?.steps ?? [])}</div>
                  </div>
                  <div className="task-chain-stage-actions">
                    <Button disabled={index === 0} onClick={() => move(index, -1)} size="small">
                      上移
                    </Button>
                    <Button
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                      size="small"
                    >
                      下移
                    </Button>
                    <Button
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      size="small"
                    >
                      移除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Modal>
    </div>
  )
}

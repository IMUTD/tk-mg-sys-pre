import { App, Button, Card, Input, Modal, Space, Tag } from "antd"
import { type ReactNode, useState } from "react"

import { createNamedChain, deleteChain, useChains } from "./chain-store"
import {
  type BehaviorChain,
  type ChainStep,
  originColor,
  originLabel,
  stepText,
  validateChainName,
} from "./rpa-api"

type ChainListProps = {
  readonly canDelete?: boolean
  readonly canWrite?: boolean
  readonly onEdit: (chain: BehaviorChain) => void
  readonly onTest: (
    name: string,
    steps: readonly ChainStep[],
    chainId: string,
    chainName?: string,
  ) => boolean
}

const saveErrorText = (error: unknown): string =>
  error instanceof Error && error.message === "chain_name_taken" ? "名称已存在" : "保存失败"

export const ChainList = ({ canDelete, canWrite, onEdit, onTest }: ChainListProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const chains = useChains()
  const [keyword, setKeyword] = useState("")
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const filtered = chains.filter((item) =>
    keyword.trim().length === 0 ? true : item.name.includes(keyword.trim()),
  )

  return (
    <div className="behaviors-pane">
      <div className="behaviors-toolbar">
        <Input
          allowClear
          aria-label="搜索行为链"
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索行为链"
          style={{ width: 240 }}
          value={keyword}
        />
        {canWrite === true ? (
          <Button
            onClick={() => {
              setName("")
              setNaming(true)
            }}
            type="primary"
          >
            创建
          </Button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <Card className="behaviors-empty">暂无行为链</Card>
      ) : (
        <div className="behaviors-card-grid">
          {filtered.map((item) => (
            <Card
              extra={
                <Space size={0}>
                  {canWrite === true ? (
                    <Button onClick={() => onEdit(item)} size="small" type="link">
                      编辑
                    </Button>
                  ) : null}
                  {allowDelete ? (
                    <Button
                      danger
                      onClick={() => {
                        void modal.confirm({
                          cancelText: "取消",
                          content: `确定删除「${item.name}」吗？删除后无法恢复。`,
                          okText: "确定",
                          onOk: async () => {
                            const ok = await deleteChain(item.id)
                            if (ok) message.success("删除成功")
                            else message.error("删除失败")
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
                </Space>
              }
              key={item.id}
              title={item.name}
            >
              <Space wrap>
                <Tag color={originColor(item.origin)}>{originLabel(item.origin)}</Tag>
                <Tag>{item.steps.length} 步</Tag>
                {item.anchor === null ? null : (
                  <Tag>账号表 · {item.anchor.key === "identifier" ? "账号" : "编号"}</Tag>
                )}
              </Space>
              <ol className="chain-steps">
                {item.steps.slice(0, 4).map((step) => {
                  const text = stepText(step)
                  return (
                    <li key={step.id} title={text}>
                      {text}
                    </li>
                  )
                })}
              </ol>
              <p className="behaviors-meta">
                上次测试：{item.lastTestAt.length === 0 ? "暂无" : item.lastTestAt}
              </p>
              <p className="behaviors-meta">所有机器人都可执行此链。</p>
              <Space className="behaviors-card-actions">
                <Button
                  onClick={() => {
                    const ok = onTest(item.name, item.steps, item.id, item.name)
                    if (ok) message.success("测试成功")
                  }}
                  type="primary"
                >
                  测试
                </Button>
              </Space>
            </Card>
          ))}
        </div>
      )}
      {naming ? (
        <Modal
          footer={
            <div className="dialog-footer">
              <Button onClick={() => setNaming(false)} type="text">
                取消
              </Button>
              <Button
                onClick={() => {
                  const error = validateChainName(name)
                  if (error !== null) {
                    message.error(error)
                    return
                  }
                  const trimmed = name.trim()
                  if (chains.some((item) => item.name === trimmed)) {
                    message.error("名称已存在")
                    return
                  }
                  void createNamedChain(trimmed)
                    .then(() => {
                      setNaming(false)
                      message.success("已创建")
                    })
                    .catch((caught: unknown) => message.error(saveErrorText(caught)))
                }}
                type="primary"
              >
                确认
              </Button>
            </div>
          }
          onCancel={() => setNaming(false)}
          open
          title="创建行为链"
          width={420}
        >
          <Input
            aria-label="行为链名称"
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入名称"
            value={name}
          />
        </Modal>
      ) : null}
    </div>
  )
}

type SaveDialogProps = {
  readonly initialName?: string
  readonly note?: string
  readonly onCancel: () => void
  readonly onSubmit: (name: string) => void
  readonly title?: string
}

export const SaveChainDialog = ({
  initialName = "",
  note = "测试成功后才会永久保存，不删除则一直可被机器人使用。",
  onCancel,
  onSubmit,
  title = "保存为行为链",
}: SaveDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [name, setName] = useState(initialName)

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button
            onClick={() => {
              const error = validateChainName(name)
              if (error !== null) {
                message.error(error)
                return
              }
              onSubmit(name)
            }}
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={title}
      width={420}
    >
      <Input
        aria-label="行为链名称"
        onChange={(event) => setName(event.target.value)}
        placeholder="请输入名称"
        value={name}
      />
      <p className="behaviors-meta">{note}</p>
    </Modal>
  )
}

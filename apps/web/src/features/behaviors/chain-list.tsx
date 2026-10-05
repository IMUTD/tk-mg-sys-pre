import { App, Button, Card, Input, Modal, Space, Tag } from "antd"
import { type ReactNode, useState } from "react"

import { deleteChain, useChains } from "./chain-store"
import { type ChainStep, originColor, originLabel, stepText, validateChainName } from "./rpa-api"

type ChainListProps = {
  readonly canDelete?: boolean
  readonly onTest: (name: string, steps: readonly ChainStep[], chainId: string) => boolean
}

export const ChainList = ({ canDelete, onTest }: ChainListProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const chains = useChains()
  const [keyword, setKeyword] = useState("")
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
      </div>
      {filtered.length === 0 ? (
        <Card className="behaviors-empty">暂无行为链</Card>
      ) : (
        <div className="behaviors-card-grid">
          {filtered.map((item) => (
            <Card
              extra={
                allowDelete ? (
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
                ) : null
              }
              key={item.id}
              title={item.name}
            >
              <Space wrap>
                <Tag color={originColor(item.origin)}>{originLabel(item.origin)}</Tag>
                <Tag>{item.steps.length} 步</Tag>
              </Space>
              <ol className="chain-steps">
                {item.steps.slice(0, 4).map((step) => (
                  <li key={step.id}>{stepText(step)}</li>
                ))}
              </ol>
              <p className="behaviors-meta">
                上次测试：{item.lastTestAt.length === 0 ? "暂无" : item.lastTestAt}
              </p>
              <p className="behaviors-meta">所有机器人都可执行此链。</p>
              <Space className="behaviors-card-actions">
                <Button
                  onClick={() => {
                    const ok = onTest(item.name, item.steps, item.id)
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
    </div>
  )
}

type SaveDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (name: string) => void
}

export const SaveChainDialog = ({ onCancel, onSubmit }: SaveDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [name, setName] = useState("")

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
      title="保存为行为链"
      width={420}
    >
      <Input
        aria-label="行为链名称"
        onChange={(event) => setName(event.target.value)}
        placeholder="请输入名称"
        value={name}
      />
      <p className="behaviors-meta">测试成功后才会永久保存，不删除则一直可被机器人使用。</p>
    </Modal>
  )
}

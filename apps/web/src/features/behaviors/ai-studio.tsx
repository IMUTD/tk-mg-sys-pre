import { App, Button, Input, Space } from "antd"
import { type ReactNode, useState } from "react"
import { SaveChainDialog } from "./chain-list"
import { saveChain } from "./chain-store"
import {
  type ChainStep,
  type ChatMessage,
  chainFingerprint,
  proposeChain,
  publishChainSteps,
  stepText,
} from "./rpa-api"

type AiStudioProps = {
  readonly canWrite: boolean
  readonly onTest: (name: string, steps: readonly ChainStep[]) => boolean
}

export const AiStudio = ({ canWrite, onTest }: AiStudioProps): ReactNode => {
  const { message } = App.useApp()
  const [draft, setDraft] = useState("")
  const [nextStepId, setNextStepId] = useState(10)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "描述你希望机器人做的事，我会用魔云腾 RPA 接口起草行为链。测试成功后可永久保存。",
    },
  ])
  const [steps, setSteps] = useState<ChainStep[]>([])
  const [testedKey, setTestedKey] = useState("")
  const [saving, setSaving] = useState(false)
  const fingerprint = chainFingerprint(steps)
  const canSave = canWrite && steps.length > 0 && testedKey === fingerprint

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0) {
      message.error("请输入需求")
      return
    }
    const proposed = proposeChain(text, nextStepId)
    setNextStepId((current) => current + proposed.steps.length)
    setMessages((current) => [
      ...current,
      { id: current.length + 1, role: "user", text },
      { id: current.length + 2, role: "assistant", text: proposed.reply },
    ])
    setSteps(proposed.steps)
    setTestedKey("")
    setDraft("")
  }

  return (
    <div className="behaviors-pane ai-studio">
      <div className="chat-log">
        {messages.map((item) => (
          <div className={`chat-bubble chat-${item.role}`} key={item.id}>
            <strong>{item.role === "assistant" ? "AI" : "我"}</strong>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
      {steps.length === 0 ? null : (
        <ol className="chain-steps">
          {steps.map((item) => (
            <li key={item.id}>{stepText(item)}</li>
          ))}
        </ol>
      )}
      {canWrite ? (
        <div className="chat-input">
          <Input.TextArea
            aria-label="AI需求"
            autoSize={{ maxRows: 4, minRows: 2 }}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="例如：打开抖音，上滑两次并点赞"
            value={draft}
          />
          <Space>
            <Button onClick={send} type="primary">
              发送
            </Button>
            <Button
              disabled={steps.length === 0}
              onClick={() => {
                const ok = onTest("AI草稿", steps)
                if (ok) {
                  setTestedKey(fingerprint)
                  message.success("测试成功，可以保存为行为链")
                }
              }}
            >
              测试
            </Button>
            <Button disabled={!canSave} onClick={() => setSaving(true)}>
              保存为行为链
            </Button>
          </Space>
        </div>
      ) : (
        <p className="behaviors-meta">仅管理员可以制定并保存行为链。</p>
      )}
      {saving ? (
        <SaveChainDialog
          onCancel={() => setSaving(false)}
          onSubmit={(name) => {
            void saveChain("ai", name, publishChainSteps(steps))
              .then(() => {
                setSaving(false)
                message.success("已永久保存")
              })
              .catch((caught: unknown) =>
                message.error(
                  caught instanceof Error && caught.message === "chain_name_taken"
                    ? "名称已存在"
                    : "保存失败",
                ),
              )
          }}
        />
      ) : null}
    </div>
  )
}

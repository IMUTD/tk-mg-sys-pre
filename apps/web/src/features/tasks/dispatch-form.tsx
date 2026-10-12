import { App, Button, Form, Modal, Radio, Select } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { createDispatchApi, type DispatchOptions } from "./dispatch-api"

type DispatchFormProps = {
  readonly groupId: string
  readonly onCancel: () => void
  readonly onCreated: () => void
}

const emptyOptions = (): DispatchOptions => ({
  accountNotes: [],
  accounts: [],
  chains: [],
  devices: [],
  pits: [1, 2, 3, 4, 5],
  proxyTags: [],
  textTags: [],
})

const boxLabel = (box: DispatchOptions["devices"][number]): string =>
  box.name.length > 0 && box.name !== box.host ? `${box.name} ${box.host}` : box.host

const accountLabel = (account: DispatchOptions["accounts"][number]): string =>
  account.note.length > 0 ? `${account.identifier}（${account.note}）` : account.identifier

export const DispatchForm = ({ groupId, onCancel, onCreated }: DispatchFormProps): ReactNode => {
  const { message } = App.useApp()
  const [options, setOptions] = useState<DispatchOptions>(emptyOptions)
  const [chainId, setChainId] = useState<string | null>(null)
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [boxIds, setBoxIds] = useState<string[]>([])
  const [pitIndexes, setPitIndexes] = useState<number[]>([])
  const [proxyTag, setProxyTag] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<number, { mode: "random" | "sequence" | "tag"; tag?: string }>>({})
  const [saving, setSaving] = useState(false)
  const chain = options.chains.find((item) => item.id === chainId)
  const textSteps = (chain?.steps ?? [])
    .map((step, sequence) => ({ sequence, step }))
    .filter((item) => item.step.api === "SendText")

  useEffect(() => {
    void createDispatchApi(groupId)
      .options()
      .then(setOptions)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }, [groupId, message])

  const submit = (): void => {
    if (chainId === null) {
      message.error("请选择任务")
      return
    }
    if (accountIds.length === 0) {
      message.error("请选择账号")
      return
    }
    if (textSteps.some((item) => texts[item.sequence]?.mode === "tag" && (texts[item.sequence]?.tag ?? "").length === 0)) {
      message.error("请选择文本池分组")
      return
    }
    setSaving(true)
    void createDispatchApi(groupId)
      .create({
        accountIds,
        boxIds,
        chainId,
        pitIndexes,
        proxyTag,
        texts: textSteps.map((item) => ({
          mode: texts[item.sequence]?.mode ?? "sequence",
          sequence: item.sequence,
          ...(texts[item.sequence]?.tag === undefined ? {} : { tag: texts[item.sequence]?.tag }),
        })),
      })
      .then(() => {
        message.success("新增成功，任务等待开始")
        onCreated()
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
      .finally(() => setSaving(false))
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button loading={saving} onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增任务"
      width={720}
    >
      <Form labelCol={{ style: { width: 110 } }} layout="horizontal" size="small">
        <Form.Item label="选择任务" required>
          <Select
            aria-label="选择任务"
            onChange={(value: string) => setChainId(value)}
            options={options.chains.map((item) => ({ label: item.name, value: item.id }))}
            placeholder="请选择行为链"
            value={chainId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择账号" required>
          <Select
            aria-label="选择账号"
            filterOption={(input, option) =>
              String(option?.label ?? "").toLowerCase().includes(input.trim().toLowerCase())
            }
            mode="multiple"
            onChange={(value: string[]) => setAccountIds(value)}
            options={options.accounts.map((item) => ({ label: accountLabel(item), value: item.id }))}
            placeholder="检索用户名，可多选"
            showSearch
            value={accountIds}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="按备注选中"
            filterOption={(input, option) =>
              String(option?.label ?? "").toLowerCase().includes(input.trim().toLowerCase())
            }
            onChange={(value: string | null) => {
              if (value === null || value.length === 0) return
              setAccountIds(options.accounts.filter((item) => item.note === value).map((item) => item.id))
            }}
            options={options.accountNotes.map((item) => ({ label: item, value: item }))}
            placeholder="或按备注一次选中"
            showSearch
            style={{ marginTop: 8 }}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择盒子">
          <Select
            allowClear
            aria-label="选择盒子"
            filterOption={(input, option) =>
              String(option?.label ?? "").toLowerCase().includes(input.trim().toLowerCase())
            }
            mode="multiple"
            onChange={(value: string[]) => setBoxIds(value)}
            options={options.devices.map((item) => ({ label: boxLabel(item), value: item.id }))}
            placeholder="不选则用账号上一次的盒子"
            showSearch
            value={boxIds}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择坑位">
          <Select
            allowClear
            aria-label="选择坑位"
            mode="multiple"
            onChange={(value: number[]) => setPitIndexes(value)}
            options={options.pits.map((item) => ({ label: String(item), value: item }))}
            placeholder="不选则用账号上一次的坑位"
            value={pitIndexes}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择代理">
          <Select
            allowClear
            aria-label="选择代理"
            onChange={(value: string | null) => setProxyTag(value)}
            options={options.proxyTags.map((item) => ({ label: item, value: item }))}
            placeholder="不选则用账号上一次的代理"
            value={proxyTag}
            virtual={false}
          />
        </Form.Item>
        {textSteps.map((item) => (
          <Form.Item key={item.sequence} label={`第 ${item.sequence + 1} 步输入文字`}>
            <Radio.Group
              onChange={(event) =>
                setTexts((current) => ({
                  ...current,
                  [item.sequence]: { ...current[item.sequence], mode: event.target.value },
                }))
              }
              value={texts[item.sequence]?.mode ?? "sequence"}
            >
              <Radio value="random">随机</Radio>
              <Radio value="sequence">顺序</Radio>
              <Radio value="tag">指定分组</Radio>
            </Radio.Group>
            {(texts[item.sequence]?.mode ?? "sequence") === "tag" ? (
              <Select
                aria-label={`第 ${item.sequence + 1} 步文本分组`}
                onChange={(value: string) =>
                  setTexts((current) => ({
                    ...current,
                    [item.sequence]: { mode: "tag", tag: value },
                  }))
                }
                options={options.textTags.map((tag) => ({ label: tag, value: tag }))}
                placeholder="选择文本池分组"
                style={{ marginTop: 8, width: "100%" }}
                value={texts[item.sequence]?.tag}
                virtual={false}
              />
            ) : null}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}

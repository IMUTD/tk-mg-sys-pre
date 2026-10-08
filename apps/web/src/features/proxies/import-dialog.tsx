import { Button, Form, Input, Modal, Radio, Switch } from "antd"
import { type ReactNode, useState } from "react"

import { importProxies, type MytProxy, PROXY_TYPE_OPTIONS } from "./myt-proxy"

type ProxyImportDialogProps = {
  readonly nextId: number
  readonly now: string
  readonly onCancel: () => void
  readonly onImported: (proxies: readonly MytProxy[]) => Promise<void> | void
}

export const ProxyImportDialog = ({
  nextId,
  now,
  onCancel,
  onImported,
}: ProxyImportDialogProps): ReactNode => {
  const [autoSeq, setAutoSeq] = useState(false)
  const [content, setContent] = useState("")
  const [expiredTime, setExpiredTime] = useState("")
  const [importing, setImporting] = useState(false)
  const [proxyType, setProxyType] = useState<"dynamic" | "static">("static")
  const [remark, setRemark] = useState("")
  const [safe, setSafe] = useState(false)
  const [save, setSave] = useState(false)
  const [tag, setTag] = useState("")
  const [tun, setTun] = useState(false)
  const [turbo, setTurbo] = useState(false)
  const [type, setType] = useState<"0" | "1" | "2">("2")
  const canSubmit = content.trim().length > 0
  const placeholder =
    type === "0"
      ? "每行一条 vmess:// 或 vless:// 链接"
      : "IP|端口|用户名|密码 或 IP:端口:用户名:密码，一行一条"

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setImporting(true)
    try {
      await onImported(
        importProxies(
          {
            autoSeq,
            content,
            expiredTime: expiredTime.trim().length === 0 ? null : expiredTime.trim(),
            proxyType,
            remark,
            safe,
            save,
            tag: tag.trim(),
            tun,
            turbo,
            type,
          },
          nextId,
          now,
        ),
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            disabled={!canSubmit}
            loading={importing}
            onClick={() => void submit()}
            type="primary"
          >
            确认导入
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="批量导入代理"
      width={720}
    >
      <Form labelCol={{ style: { width: 110 } }} layout="horizontal" size="small">
        <Form.Item label="类型">
          <Radio.Group
            onChange={(event) => setType(event.target.value)}
            optionType="button"
            options={PROXY_TYPE_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            value={type}
          />
        </Form.Item>
        {type !== "0" ? (
          <Form.Item label="类型">
            <Radio.Group onChange={(event) => setProxyType(event.target.value)} value={proxyType}>
              <Radio value="dynamic">动态代理</Radio>
              <Radio value="static">静态代理</Radio>
            </Radio.Group>
          </Form.Item>
        ) : null}
        <Form.Item label="节流">
          <Switch checked={save} disabled={type === "0"} onChange={setSave} />
        </Form.Item>
        <Form.Item label="TUN模式">
          <Switch checked={tun} onChange={setTun} />
        </Form.Item>
        <Form.Item label="强力安全模式">
          <Switch checked={safe} onChange={setSafe} />
        </Form.Item>
        {type === "2" || type === "1" ? (
          <Form.Item label="加速节点">
            <Switch checked={turbo} onChange={setTurbo} />
          </Form.Item>
        ) : null}
        <Form.Item label="分组">
          <Input
            aria-label="导入分组"
            onChange={(event) => setTag(event.target.value)}
            value={tag}
          />
        </Form.Item>
        <Form.Item label="自动生成序号">
          <Switch checked={autoSeq} onChange={setAutoSeq} />
        </Form.Item>
        <Form.Item label="有效期">
          <Input
            aria-label="导入有效期"
            onChange={(event) => setExpiredTime(event.target.value)}
            placeholder="YYYY-MM-DD HH:mm:ss"
            value={expiredTime}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="导入备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="代理内容" required>
          <Input.TextArea
            aria-label="代理内容"
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            rows={10}
            value={content}
          />
          <div className="muted material-import-hint">{placeholder}</div>
        </Form.Item>
      </Form>
    </Modal>
  )
}

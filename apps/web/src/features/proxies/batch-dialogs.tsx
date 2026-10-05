import { Alert, Button, Collapse, Form, Input, Modal, Radio, Select, Switch } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  BATCH_SWITCH_OPTIONS,
  DETECT_CHANNEL_OPTIONS,
  DETECT_MODE_OPTIONS,
  type DetectChannel,
  type DetectMode,
  type DetectOptions,
  getPrimaryCheckResult,
  getResultCountry,
  getResultIp,
  getResultStatusLabel,
  type MytProxy,
  PROXY_FAQS,
  type ProxyCheckResult,
  type ProxyDevice,
  turboNodeLabel,
  turboNodeProxies,
} from "./myt-proxy"

type Cancelable = { readonly onCancel: () => void }

export const ProxyRunDialog = ({
  devices,
  onCancel,
  onSubmit,
  proxy,
}: Cancelable & {
  readonly devices: readonly ProxyDevice[]
  readonly onSubmit: (deviceId: number, seq: number) => void
  readonly proxy: MytProxy
}): ReactNode => {
  const [deviceId, setDeviceId] = useState<number | null>(devices[0]?.id ?? null)
  const [seq, setSeq] = useState<number | null>(devices[0]?.seqs[0] ?? null)
  const device = devices.find((item) => item.id === deviceId) ?? null

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            disabled={deviceId === null || seq === null}
            onClick={() => {
              if (deviceId === null || seq === null) return
              onSubmit(deviceId, seq)
            }}
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={`运行代理[${proxy.id}]`}
      width={600}
    >
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="设备" required>
          <Select
            aria-label="设备"
            onChange={(value: number) => {
              const next = devices.find((item) => item.id === value)
              setDeviceId(value)
              setSeq(next?.seqs[0] ?? null)
            }}
            options={devices.map((item) => ({ label: item.name, value: item.id }))}
            value={deviceId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="机位" required>
          <Select
            aria-label="机位"
            onChange={(value: number) => setSeq(value)}
            options={(device?.seqs ?? []).map((item) => ({ label: String(item), value: item }))}
            value={seq}
            virtual={false}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const ProxyBatchTagDialog = ({
  onCancel,
  onSubmit,
}: Cancelable & { readonly onSubmit: (tag: string) => void }): ReactNode => {
  const [tag, setTag] = useState("")
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={() => onSubmit(tag.trim())} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="批量修改分组"
      width={480}
    >
      <Form layout="vertical" size="small">
        <Form.Item label="分组">
          <Input
            aria-label="批量分组"
            onChange={(event) => setTag(event.target.value)}
            value={tag}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const ProxyBatchTurboDialog = ({
  onCancel,
  onSubmit,
  proxies,
}: Cancelable & {
  readonly onSubmit: (turboNode: number | null) => void
  readonly proxies: readonly MytProxy[]
}): ReactNode => {
  const [turboNode, setTurboNode] = useState<number | null>(null)
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={() => onSubmit(turboNode)} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="批量修改加速节点"
      width={520}
    >
      <Form layout="vertical" size="small">
        <Form.Item label="加速">
          <Select
            allowClear
            aria-label="批量加速节点"
            onChange={(value: number | null) => setTurboNode(value ?? null)}
            options={turboNodeProxies(proxies).map((item) => ({
              label: turboNodeLabel(item),
              value: item.id,
            }))}
            placeholder="请选择"
            value={turboNode}
            virtual={false}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const ProxyBatchUpdateDialog = ({
  onCancel,
  onSubmit,
}: Cancelable & {
  readonly onSubmit: (patch: {
    expiredTime: string | null
    safe: "keep" | "off" | "on"
    save: "keep" | "off" | "on"
    tun: "keep" | "off" | "on"
  }) => void
}): ReactNode => {
  const [expiredTime, setExpiredTime] = useState("")
  const [safe, setSafe] = useState<"keep" | "off" | "on">("keep")
  const [save, setSave] = useState<"keep" | "off" | "on">("keep")
  const [tun, setTun] = useState<"keep" | "off" | "on">("keep")
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            onClick={() =>
              onSubmit({
                expiredTime: expiredTime.trim().length === 0 ? null : expiredTime.trim(),
                safe,
                save,
                tun,
              })
            }
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="批量修改代理"
      width={520}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="TUN">
          <Radio.Group
            onChange={(event) => setTun(event.target.value)}
            options={[...BATCH_SWITCH_OPTIONS]}
            value={tun}
          />
        </Form.Item>
        <Form.Item label="安全">
          <Radio.Group
            onChange={(event) => setSafe(event.target.value)}
            options={[...BATCH_SWITCH_OPTIONS]}
            value={safe}
          />
        </Form.Item>
        <Form.Item label="节流">
          <Radio.Group
            onChange={(event) => setSave(event.target.value)}
            options={[...BATCH_SWITCH_OPTIONS]}
            value={save}
          />
        </Form.Item>
        <Form.Item label="过期时间">
          <Input
            aria-label="批量过期时间"
            onChange={(event) => setExpiredTime(event.target.value)}
            placeholder="YYYY-MM-DD HH:mm:ss，留空保持"
            value={expiredTime}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const ProxyDetectDialog = ({
  count,
  onCancel,
  onSubmit,
}: Cancelable & {
  readonly count: number
  readonly onSubmit: (options: DetectOptions) => void
}): ReactNode => {
  const [channel, setChannel] = useState<DetectChannel>("us")
  const [mode, setMode] = useState<DetectMode>("quick")
  const [useTurbo, setUseTurbo] = useState(false)
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={() => onSubmit({ channel, mode, useTurbo })} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={count > 1 ? `批量检测（${count}）` : "检测选项"}
      width={520}
    >
      <Alert
        className="proxy-detect-alert"
        message="检测在浏览器本地模拟连通结果，不会向真实代理地址发起请求。"
        showIcon
        type="info"
      />
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="模式">
          <Radio.Group
            onChange={(event) => setMode(event.target.value)}
            options={[...DETECT_MODE_OPTIONS]}
            value={mode}
          />
        </Form.Item>
        <Form.Item label="通道">
          <Radio.Group
            onChange={(event) => setChannel(event.target.value)}
            options={[...DETECT_CHANNEL_OPTIONS]}
            value={channel}
          />
        </Form.Item>
        <Form.Item label="带中转检测">
          <Switch checked={useTurbo} onChange={setUseTurbo} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export const ProxyCheckResultDialog = ({
  onCancel,
  proxyId,
  result,
}: Cancelable & { readonly proxyId: number; readonly result: ProxyCheckResult }): ReactNode => {
  const primary = getPrimaryCheckResult(result)
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="primary">
            关闭
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={`检测结果[${proxyId}]`}
      width={640}
    >
      <div className="proxy-result-summary">
        <span>{getResultStatusLabel(result.ok)}</span>
        <span>{getResultIp(primary)}</span>
        <span>{getResultCountry(primary)}</span>
      </div>
      <pre className="proxy-result-json">{JSON.stringify(result, null, 2)}</pre>
    </Modal>
  )
}

export const ProxyFaqDialog = ({ onCancel }: Cancelable): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="primary">
          关闭
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="常见问题"
    width={700}
  >
    <Collapse
      items={PROXY_FAQS.map((item) => ({
        children: item.answer,
        key: item.key,
        label: item.question,
      }))}
    />
  </Modal>
)

export const ProxyBuyDialog = ({ onCancel }: Cancelable): ReactNode => {
  const packages = useMemo(
    () => [
      { name: "动态流量 2GB", price: "低至 2.6 元/G" },
      { name: "静态 IP 月套餐", price: "按线路询价" },
    ],
    [],
  )
  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="primary">
            知道了
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="购买代理"
      width={520}
    >
      <Alert
        message="仅用于跨境业务运营使用，不得用于违法违规用途。本地演示环境不支持在线支付，代理资源请通过新增或批量导入录入。"
        showIcon
        type="warning"
      />
      <ul className="proxy-buy-list">
        {packages.map((item) => (
          <li key={item.name}>
            {item.name} · {item.price}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

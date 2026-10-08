import { App, Button, Form, Input, Modal, Radio, Select, Switch } from "antd"
import { type ReactNode, useState } from "react"

import {
  extraModeLabel,
  genCurlCmd,
  type MytProxy,
  PROXY_TYPE_OPTIONS,
  turboNodeLabel,
  turboNodeProxies,
} from "./myt-proxy"

type ProxyFormDialogProps = {
  readonly busy?: boolean
  readonly onCancel: () => void
  readonly onSubmit: (proxy: MytProxy) => void
  readonly proxies: readonly MytProxy[]
  readonly record: MytProxy
}

export const ProxyFormDialog = ({
  onCancel,
  onSubmit,
  proxies,
  record,
  busy = false,
}: ProxyFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [extra, setExtra] = useState(record.extra)
  const [expiredTime, setExpiredTime] = useState(record.expiredTime ?? "")
  const [ip, setIp] = useState(record.ip)
  const [password, setPassword] = useState(record.password)
  const [port, setPort] = useState(record.port)
  const [proxyType, setProxyType] = useState(record.proxyType)
  const [refreshUrl, setRefreshUrl] = useState(record.refreshUrl)
  const [region, setRegion] = useState(record.region)
  const [remark, setRemark] = useState(record.remark)
  const [safe, setSafe] = useState(record.safe)
  const [save, setSave] = useState(record.save)
  const [tag, setTag] = useState(record.tag)
  const [tun, setTun] = useState(record.tun)
  const [turbo, setTurbo] = useState(record.turbo)
  const [turboNode, setTurboNode] = useState<number | null>(record.turboNode)
  const [turboNodeList, setTurboNodeList] = useState<number[]>([...record.turboNodeList])
  const [type, setType] = useState(record.type)
  const [username, setUsername] = useState(record.username)
  const turboOptions = turboNodeProxies(proxies)
    .filter((item) => item.id !== record.id && item.groupId === record.groupId)
    .map((item) => ({
      label: turboNodeLabel(item),
      value: item.id,
    }))
  const isV2 = type === "0"
  const isBuiltin = type === "3"
  const showHttpFields = !isBuiltin
  const showPassword = !isV2 && !isBuiltin
  const showProxyKind = !isV2 && !isBuiltin
  const showSaveTurbo = !isV2

  const submit = (): void => {
    if (
      !isV2 &&
      (ip.trim().length === 0 || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    ) {
      message.error("请填写代理 IP 或域名，以及 1-65535 的端口")
      return
    }
    if (isV2 && extra.trim().length === 0) {
      message.error("请填写 VMess/VLESS 链接或出站 JSON")
      return
    }
    if (showHttpFields && ip.trim().length > 0 && port.trim().length === 0) {
      message.error("请填写端口")
      return
    }
    onSubmit({
      ...record,
      extra: extra.trim(),
      expiredTime: expiredTime.trim().length === 0 ? null : expiredTime.trim(),
      ip: ip.trim(),
      password,
      port: port.trim(),
      proxyType: showProxyKind ? proxyType : "static",
      refreshUrl: refreshUrl.trim(),
      region: region.trim(),
      remark,
      safe,
      save: showSaveTurbo ? save : false,
      tag,
      tun,
      turbo: isV2 || turbo,
      turboNode: showSaveTurbo ? turboNode : null,
      turboNodeList: showSaveTurbo ? turboNodeList : [],
      type,
      username: username.trim(),
    })
  }

  const copyCurl = (): void => {
    const command = genCurlCmd({
      ip: ip.trim(),
      password,
      port: port.trim(),
      type,
      username: username.trim(),
    })
    void navigator.clipboard?.writeText(command).catch(() => undefined)
    message.success(command)
  }

  return (
    <Modal
      centered
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button loading={busy} onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={record.id === 0 ? "新增代理" : "修改代理"}
      styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto" } }}
      width={600}
    >
      <Form labelCol={{ style: { width: 110 } }} layout="horizontal" size="small">
        <Form.Item label="类型" required>
          <Radio.Group
            disabled={isBuiltin}
            onChange={(event) => setType(event.target.value)}
            optionType="button"
            options={PROXY_TYPE_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            value={type}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
        {showHttpFields ? (
          <>
            <Form.Item label="IP">
              <Input
                aria-label="IP"
                onChange={(event) => setIp(event.target.value)}
                placeholder="域名或者IP地址"
                value={ip}
              />
            </Form.Item>
            <Form.Item label="端口">
              <Input
                aria-label="端口"
                onChange={(event) => setPort(event.target.value)}
                placeholder="端口"
                value={port}
              />
            </Form.Item>
          </>
        ) : null}
        {type === "1" || type === "2" || type === "3" ? (
          <Form.Item label="测试命令">
            <Button onClick={copyCurl}>生成测试命令</Button>
          </Form.Item>
        ) : null}
        {showHttpFields ? (
          <Form.Item label={isV2 ? "UUID" : "账号"}>
            <Input
              aria-label={isV2 ? "UUID" : "账号"}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="动态代理使用{}代替sessionId,避免使用轮换代理"
              value={username}
            />
          </Form.Item>
        ) : null}
        {isV2 ? (
          <Form.Item label="扩展参数">
            <Input
              aria-label="扩展参数"
              onChange={(event) => setExtra(event.target.value)}
              placeholder="支持导入链接地址,以及转换后的json格式"
              value={extra}
            />
            {extra.length > 0 ? <div className="muted">{extraModeLabel(extra)}</div> : null}
          </Form.Item>
        ) : null}
        {showPassword ? (
          <Form.Item label="密码">
            <Input.Password
              aria-label="密码"
              onChange={(event) => setPassword(event.target.value)}
              value={password}
            />
          </Form.Item>
        ) : null}
        {showProxyKind ? (
          <Form.Item label="类型">
            <Radio.Group onChange={(event) => setProxyType(event.target.value)} value={proxyType}>
              <Radio value="dynamic">动态代理</Radio>
              <Radio value="static">静态代理</Radio>
            </Radio.Group>
          </Form.Item>
        ) : null}
        {showSaveTurbo ? (
          <>
            <Form.Item label="节流">
              <Switch checked={save} onChange={setSave} />
              <span className="form-hint form-hint-warn">需要有加速节点或者在海外环境</span>
            </Form.Item>
            <Form.Item label="加速">
              <Select
                allowClear
                aria-label="加速"
                onChange={(value: number | null) => setTurboNode(value ?? null)}
                options={turboOptions}
                placeholder="请选择"
                style={{ width: "100%", maxWidth: 370 }}
                value={turboNode}
                virtual={false}
              />
            </Form.Item>
            <Form.Item label="加速列表">
              <Select
                allowClear
                aria-label="加速列表"
                maxCount={10}
                mode="multiple"
                onChange={(value: number[]) => setTurboNodeList(value)}
                options={turboOptions}
                placeholder="请选择多个加速节点（优先使用）"
                style={{ width: "100%", maxWidth: 370 }}
                value={turboNodeList}
                virtual={false}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="TUN模式">
          <Switch checked={tun} onChange={setTun} />
          <span className="form-hint form-hint-warn">全局接管模式</span>
        </Form.Item>
        <Form.Item label="强力安全模式">
          <Switch checked={safe} onChange={setSafe} />
          <span className="form-hint form-hint-danger">
            配合TUN模式打开,强隐私,使用前请联系客服确认
          </span>
        </Form.Item>
        {type === "2" || type === "1" ? (
          <Form.Item label="加速节点">
            <Switch aria-label="加速节点" checked={turbo} onChange={setTurbo} />
          </Form.Item>
        ) : null}
        {showSaveTurbo ? (
          <Form.Item label="地区检测">
            <Input
              aria-label="地区检测"
              onChange={(event) => setRegion(event.target.value)}
              style={{ width: 80 }}
              value={region}
            />
            <span className="form-hint form-hint-warn">防止IP跳非目标地区,留空不检测,如:US,CA</span>
          </Form.Item>
        ) : null}
        <Form.Item label="分组">
          <Input aria-label="分组" onChange={(event) => setTag(event.target.value)} value={tag} />
        </Form.Item>
        {showHttpFields ? (
          <Form.Item label="有效期">
            <Input
              aria-label="有效期"
              onChange={(event) => setExpiredTime(event.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
              style={{ width: 190 }}
              value={expiredTime}
            />
            <span className="form-hint">仅作为到期提醒</span>
          </Form.Item>
        ) : null}
        <Form.Item label="刷新URL">
          <Input
            aria-label="刷新URL"
            onChange={(event) => setRefreshUrl(event.target.value)}
            value={refreshUrl}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

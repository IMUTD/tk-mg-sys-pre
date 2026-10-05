import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, Button, Card, Descriptions, Input, Select, Space, Tag, Typography } from "antd"
import { type FormEvent, type ReactNode, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import type { DeviceCommand, DevicesApi } from "./api"
import "./devices.css"

type DeviceDetailPageProps = {
  readonly api: DevicesApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly deviceId: string
  readonly groupId: string
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "保存失败，请稍后重试"

export const DeviceDetailPage = ({
  api,
  canDelete,
  canWrite,
  deviceId,
  groupId,
}: DeviceDetailPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const device = useQuery({
    queryFn: () => api.get({ deviceId, groupId }),
    queryKey: ["device", groupId, deviceId],
  })
  const status = useQuery({
    queryFn: () => api.status({ deviceId, groupId }),
    queryKey: ["device-status", groupId, deviceId],
  })
  const [error, setError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState<DeviceCommand | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const command = useQuery({
    enabled: activeCommand !== null,
    queryFn: () => api.getCommand({ commandId: activeCommand?.id ?? "", deviceId, groupId }),
    queryKey: ["device-command", groupId, deviceId, activeCommand?.id],
    refetchInterval: (query) => {
      const statusValue = query.state.data?.status
      return statusValue === "queued" || statusValue === "running" ? 1_000 : false
    },
  })

  const submitCommand = async (type: "health_check" | "capture_screen"): Promise<void> => {
    const instanceId =
      type === "capture_screen" ? selectedInstanceId || device.data?.instances[0]?.id : undefined
    if (type === "capture_screen" && instanceId === undefined) return
    setCommandError(null)
    setIsSubmitting(true)
    try {
      const submitted = await api.submitCommand({
        deviceId,
        groupId,
        idempotencyKey: crypto.randomUUID(),
        ...(instanceId === undefined ? {} : { instanceId }),
        type,
      })
      setActiveCommand(submitted)
      queryClient.setQueryData(["device-command", groupId, deviceId, submitted.id], submitted)
    } catch (requestError) {
      setCommandError(errorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelCommand = async (): Promise<void> => {
    const currentCommand = command.data ?? activeCommand
    if (currentCommand === null) return
    setCommandError(null)
    setIsCancelling(true)
    try {
      const cancelled = await api.cancelCommand({
        commandId: currentCommand.id,
        deviceId,
        groupId,
      })
      setActiveCommand(cancelled)
      queryClient.setQueryData(["device-command", groupId, deviceId, cancelled.id], cancelled)
    } catch (requestError) {
      setCommandError(errorMessage(requestError))
    } finally {
      setIsCancelling(false)
    }
  }

  const saveDevice = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    try {
      await api.update({
        bridge: form.get("bridge") === "on",
        deviceId,
        enabled: form.get("enabled") === "on",
        groupId,
        host: `${form.get("host") ?? ""}`,
        model: `${form.get("model") ?? ""}`,
        name: `${form.get("name") ?? ""}`,
        version: `${form.get("version") ?? ""}` || null,
      })
      await device.refetch()
      await status.refetch()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  const saveInstance = async (
    event: FormEvent<HTMLFormElement>,
    instanceId: string,
  ): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    try {
      await api.updateInstance({
        deviceId,
        enabled: form.get("enabled") === "on",
        groupId,
        index: Number(form.get("index")),
        instanceId,
        label: `${form.get("label") ?? ""}`,
      })
      await device.refetch()
      await status.refetch()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  const createInstance = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    try {
      await api.createInstance({
        deviceId,
        groupId,
        index: Number(form.get("index")),
        label: `${form.get("label") ?? ""}`,
      })
      event.currentTarget.reset()
      await device.refetch()
      await status.refetch()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  const deleteDevice = async (): Promise<void> => {
    if (!window.confirm("确认删除此盒子及其所有实例吗？")) {
      return
    }
    setError(null)
    try {
      await api.delete({ deviceId, groupId })
      navigate("/operations/devices")
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  const deleteInstance = async (instanceId: string): Promise<void> => {
    if (!window.confirm("确认删除此实例吗？")) {
      return
    }
    setError(null)
    try {
      await api.deleteInstance({ deviceId, groupId, instanceId })
      await device.refetch()
      await status.refetch()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  if (device.isPending) {
    return <p className="device-message">正在加载设备详情…</p>
  }
  if (device.isError || device.data === undefined) {
    return (
      <Alert className="form-error" message={errorMessage(device.error)} showIcon type="error" />
    )
  }

  return (
    <section className="module-page device-detail-page">
      <div className="page-toolbar">
        <div>
          <Typography.Title level={2}>{device.data.name}</Typography.Title>
          <Typography.Paragraph type="secondary">
            修正内网 IP、启停盒子，维护实例编号。
          </Typography.Paragraph>
        </div>
        <Link to="/operations/devices">
          <Button>返回盒子管理</Button>
        </Link>
      </div>
      {error === null ? null : (
        <Alert className="form-error" message={error} showIcon type="error" />
      )}
      <Card>
        <form className="device-edit-form" onSubmit={(event) => void saveDevice(event)}>
          <label htmlFor="device-name">
            名称
            <Input
              defaultValue={device.data.name}
              disabled={!canWrite}
              id="device-name"
              name="name"
              required
            />
          </label>
          <label htmlFor="device-host">
            内网 IP / 主机
            <Input
              defaultValue={device.data.host}
              disabled={!canWrite}
              id="device-host"
              name="host"
              required
            />
          </label>
          <label htmlFor="device-model">
            型号
            <Input
              defaultValue={device.data.model}
              disabled={!canWrite}
              id="device-model"
              name="model"
              required
            />
          </label>
          <label htmlFor="device-version">
            版本
            <Input
              defaultValue={device.data.version ?? ""}
              disabled={!canWrite}
              id="device-version"
              name="version"
            />
          </label>
          <label className="device-checkbox">
            <input
              defaultChecked={device.data.bridge}
              disabled={!canWrite}
              name="bridge"
              type="checkbox"
            />
            桥接模式
          </label>
          <label className="device-checkbox">
            <input
              defaultChecked={device.data.enabled}
              disabled={!canWrite}
              name="enabled"
              type="checkbox"
            />
            启用盒子
          </label>
          <Space>
            <Button disabled={!canWrite} htmlType="submit" type="primary">
              保存设备配置
            </Button>
            {allowDelete ? (
              <Button danger onClick={() => void deleteDevice()}>
                删除盒子
              </Button>
            ) : null}
          </Space>
        </form>
      </Card>
      <Card className="device-status-card" title="状态">
        <Descriptions column={3} size="small">
          <Descriptions.Item label="监控">
            <Tag color="default">{status.data?.monitoring.state ?? "unconfigured"}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="盒子状态">
            <Tag color={status.data?.observation.state === "online" ? "success" : "default"}>
              {status.data?.observation.state ?? "unknown"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="最后观测">
            {status.data?.observation.observedAt?.toLocaleString("zh-CN", { hour12: false }) ??
              "未观测"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card className="device-command-card" title="设备命令">
        <Space className="device-command-actions" wrap>
          <Button
            disabled={!canWrite || !device.data.enabled}
            loading={isSubmitting}
            onClick={() => void submitCommand("health_check")}
            type="primary"
          >
            健康检查
          </Button>
          <Select
            aria-label="截图实例"
            disabled={!canWrite || !device.data.enabled || device.data.instances.length === 0}
            onChange={setSelectedInstanceId}
            options={device.data.instances.map((instance) => ({
              label: instance.label,
              value: instance.id,
            }))}
            placeholder="选择实例"
            value={selectedInstanceId || device.data.instances[0]?.id || ""}
          />
          <Button
            disabled={!canWrite || !device.data.enabled || device.data.instances.length === 0}
            loading={isSubmitting}
            onClick={() => void submitCommand("capture_screen")}
          >
            截取屏幕
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          命令结果独立于设备监控状态；监控仍为 {status.data?.monitoring.state ?? "unconfigured"}。
        </Typography.Paragraph>
        {isSubmitting ? <Tag color="processing">submitting</Tag> : null}
        {commandError === null ? null : <Alert message={commandError} showIcon type="error" />}
        {command.isError ? (
          <Alert message={errorMessage(command.error)} showIcon type="error" />
        ) : null}
        {(() => {
          const currentCommand = command.data ?? activeCommand
          if (currentCommand === null) return null
          const isNonterminal =
            currentCommand.status === "queued" || currentCommand.status === "running"
          return (
            <div className="device-command-result" aria-live="polite">
              <Space>
                <Typography.Text>命令状态</Typography.Text>
                <Tag color={currentCommand.status === "succeeded" ? "success" : "default"}>
                  {currentCommand.status}
                </Tag>
                {isNonterminal && canWrite && device.data.enabled ? (
                  <Button danger loading={isCancelling} onClick={() => void cancelCommand()}>
                    取消命令
                  </Button>
                ) : null}
              </Space>
              {currentCommand.status === "failed" || currentCommand.status === "timed_out" ? (
                <Typography.Text type="danger">{currentCommand.errorCode}</Typography.Text>
              ) : null}
              {currentCommand.result?.kind === "no_artifact" ? (
                <Typography.Text>无截图产物 (no artifact)</Typography.Text>
              ) : null}
              {currentCommand.result?.kind === "acknowledged" ? (
                <Typography.Text>命令已完成</Typography.Text>
              ) : null}
              {currentCommand.result?.kind === "health" ? (
                <Typography.Text>健康结果: {currentCommand.result.status}</Typography.Text>
              ) : null}
            </div>
          )
        })()}
      </Card>
      <Card className="device-instance-editor" title="实例">
        {device.data.instances.map((instance) => (
          <form
            className="instance-edit-form"
            key={instance.id}
            onSubmit={(event) => void saveInstance(event, instance.id)}
          >
            <Input defaultValue={instance.label} disabled={!canWrite} name="label" required />
            <Input
              defaultValue={instance.index}
              disabled={!canWrite}
              max={24}
              min={1}
              name="index"
              required
              type="number"
            />
            <label className="device-checkbox">
              <input
                defaultChecked={instance.enabled}
                disabled={!canWrite}
                name="enabled"
                type="checkbox"
              />
              启用
            </label>
            <Button disabled={!canWrite} htmlType="submit">
              保存实例
            </Button>
            {allowDelete ? (
              <Button danger onClick={() => void deleteInstance(instance.id)}>
                删除实例
              </Button>
            ) : null}
          </form>
        ))}
        {canWrite ? (
          <form className="instance-edit-form" onSubmit={(event) => void createInstance(event)}>
            <Input aria-label="新实例标签" name="label" placeholder="实例标签" required />
            <Input
              aria-label="新实例编号"
              max={24}
              min={1}
              name="index"
              placeholder="编号"
              required
              type="number"
            />
            <Button htmlType="submit">新增实例</Button>
          </form>
        ) : null}
      </Card>
    </section>
  )
}

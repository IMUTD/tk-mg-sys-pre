import { Button, Card, Input, Typography } from "antd"
import type { FormEvent, ReactNode } from "react"
import { useNavigate } from "react-router-dom"

import type { DevicesApi } from "./api"
import "./devices.css"

type DeviceCreatePageProps = {
  readonly api: DevicesApi
  readonly groupId: string
}

export const DeviceCreatePage = ({ api, groupId }: DeviceCreatePageProps): ReactNode => {
  const navigate = useNavigate()
  const createDevice = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const device = await api.create({
      bridge: form.get("bridge") === "on",
      groupId,
      host: `${form.get("host") ?? ""}`,
      model: `${form.get("model") ?? ""}`,
      name: `${form.get("name") ?? ""}`,
    })
    navigate(`/operations/devices/${device.id}?groupId=${encodeURIComponent(groupId)}`)
  }

  return (
    <section className="module-page device-detail-page">
      <div className="page-toolbar">
        <div>
          <Typography.Title level={2}>登记盒子</Typography.Title>
          <Typography.Paragraph type="secondary">
            录入盒子的内网地址与连接模式。
          </Typography.Paragraph>
        </div>
      </div>
      <Card>
        <form className="device-edit-form" onSubmit={(event) => void createDevice(event)}>
          <label htmlFor="device-name">
            名称
            <Input id="device-name" name="name" required />
          </label>
          <label htmlFor="device-host">
            内网 IP / 主机
            <Input id="device-host" name="host" required />
          </label>
          <label htmlFor="device-model">
            型号
            <Input defaultValue="Magic Cloud V3" id="device-model" name="model" required />
          </label>
          <label className="device-checkbox">
            <input name="bridge" type="checkbox" />
            桥接模式
          </label>
          <Button htmlType="submit" type="primary">
            保存并配置实例
          </Button>
        </form>
      </Card>
    </section>
  )
}

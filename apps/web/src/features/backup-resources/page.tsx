import { App, Button, Collapse, Empty, Input, Modal, Select, Space, Table, Tag, type TableColumnsType } from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { filteredRowSelection } from "../../components/tables/filtered-selection"

type ShareFile = {
  id: string
  mtime: string | null
  name: string
  path: string
  sha256: string
  size: number
}

type ShareDirectory = {
  files: ShareFile[]
  path: string
}

type ShareBox = {
  deviceId: string
  directories: ShareDirectory[]
  finishedAt: string | null
  host: string
  name: string
  online?: boolean
  scanStatus: string | null
}

const scanText = (status: string | null): string => {
  if (status === "pending") return "等待领取"
  if (status === "running") return "扫描中"
  if (status === "complete") return "已扫描"
  if (status === "failed") return "扫描失败"
  return "未扫描"
}

const sizeText = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const columns: TableColumnsType<ShareFile> = [
  { dataIndex: "name", title: "文件" },
  { dataIndex: "path", title: "目录中的位置", width: 280 },
  { dataIndex: "size", render: (value: number) => sizeText(value), title: "大小", width: 110 },
  {
    dataIndex: "mtime",
    render: (value: string | null) => (value ? value.replace("T", " ").slice(0, 19) : ""),
    title: "修改时间",
    width: 180,
  },
]

export const BackupResourcesPage = (): ReactNode => {
  const { message } = App.useApp()
  const [boxes, setBoxes] = useState<ShareBox[]>([])
  const [selected, setSelected] = useState<readonly string[]>([])
  const [open, setOpen] = useState(false)
  const [targetDeviceId, setTargetDeviceId] = useState("")
  const [targetDirectory, setTargetDirectory] = useState("")
  const [sending, setSending] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch("/api/share-files?bucket=backup", { credentials: "same-origin" })
    if (!response.ok) return
    const body = (await response.json()) as { boxes: ShareBox[] }
    setBoxes(body.boxes)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!boxes.some((box) => box.scanStatus === "pending" || box.scanStatus === "running")) return
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [boxes, load])

  const filesById = useMemo(() => {
    const map = new Map<string, ShareFile>()
    for (const box of boxes) {
      for (const dir of box.directories) {
        for (const file of dir.files) map.set(file.id, file)
      }
    }
    return map
  }, [boxes])

  const scan = async (): Promise<void> => {
    setScanning(true)
    const response = await fetch("/api/share-scans", {
      body: JSON.stringify({ scope: "backup" }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    setScanning(false)
    if (!response.ok) {
      message.error("扫描没有下发")
      return
    }
    const body = (await response.json()) as { scans: { host?: string; name?: string; status: string }[] }
    const offline = body.scans.filter((item) => item.status === "offline")
    const busy = body.scans.filter((item) => item.status === "busy").length
    const sent = body.scans.filter((item) => item.status === "pending" || item.status === "running").length
    if (sent === 0 && offline.length > 0) {
      message.error("无法扫描")
      await load()
      return
    }
    if (offline.length > 0) {
      const names = offline
        .map((item) => item.host || item.name || "")
        .filter((name) => name !== "")
        .join("、")
      message.warning(names === "" ? "无法扫描" : `无法扫描：${names} 不在线`)
    }
    if (sent === 0) {
      message.warning("盒子正在扫描其他目录")
      await load()
      return
    }
    message.success(
      busy === 0 ? `已向 ${sent} 台盒子下发扫描` : `已向 ${sent} 台盒子下发扫描，另有 ${busy} 台正在扫描其他目录`,
    )
    await load()
  }

  const transfer = async (): Promise<void> => {
    setSending(true)
    const response = await fetch("/api/share-transfers", {
      body: JSON.stringify({ fileIds: selected, targetDeviceId, targetDirectory: targetDirectory.trim() }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    setSending(false)
    if (!response.ok) {
      message.error("转移没有下发")
      return
    }
    message.success("转移任务已下发，对应盒子领到后会复制文件")
    setOpen(false)
    setSelected([])
  }

  return (
    <section className="module-page">
      <Space style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button disabled={selected.length === 0} onClick={() => setOpen(true)}>
          转移到目录
        </Button>
        <Button loading={scanning} onClick={() => void scan()} type="primary">
          扫描盒子备份
        </Button>
      </Space>
      {boxes.length === 0 ? <Empty description="这个管理员名下还没有盒子" /> : null}
      <Collapse
        items={boxes.map((box) => ({
          children:
            box.directories.length === 0 ? (
              <Empty description="还没有备份文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Collapse
                items={box.directories.map((dir) => ({
                  children: (
                    <Table
                      columns={columns}
                      dataSource={dir.files}
                      pagination={false}
                      rowKey="id"
                      rowSelection={filteredRowSelection({
                        onChange: (keys) => setSelected(keys.map(String)),
                        rowKey: "id",
                        rows: dir.files,
                        selectedKeys: selected,
                      })}
                      size="small"
                    />
                  ),
                  key: dir.path || "/",
                  label: dir.path === "" ? `根目录（${dir.files.length}）` : `${dir.path}（${dir.files.length}）`,
                }))}
              />
            ),
          key: box.deviceId,
          label: (
            <Space>
              <span>{box.name || box.host}</span>
              <span>{box.host}</span>
              <Tag color={box.online === false ? "default" : "success"}>
                {box.online === false ? "离线" : "在线"}
              </Tag>
              <Tag>{scanText(box.scanStatus)}</Tag>
            </Space>
          ),
        }))}
      />
      <Modal
        confirmLoading={sending}
        okButtonProps={{ disabled: targetDeviceId === "" }}
        okText="转移"
        onCancel={() => setOpen(false)}
        onOk={() => void transfer()}
        open={open}
        title={`转移 ${selected.length} 个备份`}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            onChange={setTargetDeviceId}
            options={boxes.map((box) => ({ label: `${box.name || box.host} ${box.host}`, value: box.deviceId }))}
            placeholder="目标盒子"
            style={{ width: "100%" }}
            value={targetDeviceId || undefined}
          />
          <Input
            onChange={(event) => setTargetDirectory(event.target.value)}
            placeholder="目标目录，留空表示这台盒子备份目录的根目录"
            value={targetDirectory}
          />
          <span>
            {selected
              .map((id) => filesById.get(id)?.name)
              .filter(Boolean)
              .slice(0, 8)
              .join("、")}
          </span>
        </Space>
      </Modal>
    </section>
  )
}

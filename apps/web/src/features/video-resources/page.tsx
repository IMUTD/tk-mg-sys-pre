import { App, Button, Collapse, Empty, Input, Modal, Select, Space, Table, Tabs, Tag, type TableColumnsType } from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
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

type ScanReply = {
  host?: string
  name?: string
  status: string
}

const reportScan = (
  scans: readonly ScanReply[],
  notify: {
    error: (text: string) => void
    success: (text: string) => void
    warning: (text: string) => void
  },
): void => {
  const offline = scans.filter((item) => item.status === "offline")
  const busy = scans.filter((item) => item.status === "busy").length
  const sent = scans.filter((item) => item.status === "pending" || item.status === "running").length
  if (sent === 0 && offline.length > 0) {
    notify.error("无法扫描")
    return
  }
  if (offline.length > 0) {
    const names = offline
      .map((item) => item.host || item.name || "")
      .filter((name) => name !== "")
      .join("、")
    notify.warning(names === "" ? "无法扫描" : `无法扫描：${names} 不在线`)
  }
  if (sent === 0) {
    notify.warning("盒子正在扫描其他目录")
    return
  }
  notify.success(
    busy === 0 ? `已向 ${sent} 台盒子下发扫描` : `已向 ${sent} 台盒子下发扫描，另有 ${busy} 台正在扫描其他目录`,
  )
}

const poolCategories = [
  { key: "text", label: "文本" },
  { key: "image", label: "图片" },
  { key: "other", label: "其他" },
] as const

type PoolCategory = (typeof poolCategories)[number]["key"]
type ShareCategory = PoolCategory | "video" | "backup"

const isPoolCategory = (value: string | null): value is PoolCategory =>
  poolCategories.some((item) => item.key === value)

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

type VideoResourcesPageProps = {
  readonly view?: "backup" | "image" | "pool" | "video"
}

export const VideoResourcesPage = ({ view = "pool" }: VideoResourcesPageProps): ReactNode => {
  const { message } = App.useApp()
  const [params, setParams] = useSearchParams()
  const requested = params.get("tab")
  const category: ShareCategory =
    view === "video"
      ? "video"
      : view === "backup"
        ? "backup"
        : view === "image"
          ? "image"
          : isPoolCategory(requested)
            ? requested
            : "text"
  const backup = category === "backup"
  const canTransfer = category === "video" || category === "image" || backup
  const [boxes, setBoxes] = useState<ShareBox[]>([])
  const [selected, setSelected] = useState<readonly string[]>([])
  const [open, setOpen] = useState(false)
  const [targetDeviceId, setTargetDeviceId] = useState("")
  const [targetDirectory, setTargetDirectory] = useState("")
  const [sending, setSending] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    const query = backup ? "bucket=backup" : `category=${category}`
    const response = await fetch(`/api/share-files?${query}`, { credentials: "same-origin" })
    if (!response.ok) return
    const body = (await response.json()) as { boxes: ShareBox[] }
    setBoxes(body.boxes)
  }, [backup, category])

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
    const response = await fetch(
      "/api/share-scans",
      backup
        ? {
            body: JSON.stringify({ scope: "backup" }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        : { credentials: "same-origin", method: "POST" },
    )
    setScanning(false)
    if (!response.ok) {
      message.error("扫描没有下发")
      return
    }
    const body = (await response.json()) as { scans: ScanReply[] }
    reportScan(body.scans, message)
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
    message.success(
      backup ? "转移任务已下发，对应盒子领到后会复制文件" : "转移任务已下发，对应盒子领到后会搬运文件",
    )
    setOpen(false)
    setSelected([])
  }

  return (
    <section className="module-page">
      {view === "pool" ? (
        <Tabs
          activeKey={category}
          items={poolCategories.map((item) => ({ key: item.key, label: item.label }))}
          onChange={(key) => {
            setParams(
              (current) => {
                const next = new URLSearchParams(current)
                if (key === "text") next.delete("tab")
                else next.set("tab", key)
                return next
              },
              { replace: true },
            )
            setSelected([])
          }}
          tabBarExtraContent={
            <Button loading={scanning} onClick={() => void scan()} type="primary">
              扫描盒子资源
            </Button>
          }
        />
      ) : (
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
          {canTransfer ? (
            <Button disabled={selected.length === 0} onClick={() => setOpen(true)}>
              转移到目录
            </Button>
          ) : null}
          <Button loading={scanning} onClick={() => void scan()} type="primary">
            {backup ? "扫描盒子备份" : "扫描盒子资源"}
          </Button>
        </Space>
      )}
      {boxes.length === 0 ? <Empty description="这个管理员名下还没有盒子" /> : null}
      <Collapse
        items={boxes.map((box) => ({
          children:
            box.directories.length === 0 ? (
              <Empty
                description={backup ? "还没有备份文件" : "这个分类下还没有文件"}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <Collapse
                items={box.directories.map((dir) => ({
                  children: (
                    <Table
                      columns={columns}
                      dataSource={dir.files}
                      pagination={false}
                      rowKey="id"
                      rowSelection={
                        canTransfer
                          ? filteredRowSelection({
                              onChange: (keys) => setSelected(keys.map(String)),
                              rowKey: "id",
                              rows: dir.files,
                              selectedKeys: selected,
                            })
                          : undefined
                      }
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
        title={`转移 ${selected.length} 个${backup ? "备份" : category === "image" ? "图片" : "视频"}`}
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
            placeholder={
              backup
                ? "目标目录，留空表示这台盒子备份目录的根目录"
                : "目标目录，留空表示放到目标盒子同一桶的根目录"
            }
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

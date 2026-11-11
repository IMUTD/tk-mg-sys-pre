import {
  App,
  Button,
  Collapse,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Tabs,
  Tag,
} from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { filteredRowSelection } from "../../components/tables/filtered-selection"

type ShareFile = {
  id: string
  lastAccount?: string
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
  deviceId?: string
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
    busy === 0
      ? `已向 ${sent} 台盒子下发扫描`
      : `已向 ${sent} 台盒子下发扫描，另有 ${busy} 台正在扫描其他目录`,
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

type NasDirectory = {
  id: string
  name: string
}

type NasGroup = {
  directories?: NasDirectory[]
  files: ShareFile[]
  nasId: string
}

type BackupFolder = {
  files: ShareFile[]
  id: string
  name: string
}

const backupFolders = (
  files: readonly ShareFile[],
  directories: readonly NasDirectory[],
): { folders: BackupFolder[]; loose: ShareFile[] } => {
  const folders = new Map<string, BackupFolder>()
  for (const dir of directories) folders.set(dir.name, { files: [], id: dir.id, name: dir.name })
  const loose: ShareFile[] = []
  for (const file of files) {
    const slash = file.path.indexOf("/")
    if (slash <= 0) {
      loose.push(file)
      continue
    }
    const name = file.path.slice(0, slash)
    const folder = folders.get(name)
    if (folder === undefined) folders.set(name, { files: [file], id: "", name })
    else folder.files.push(file)
  }
  return { folders: [...folders.values()], loose }
}

type NasChoice = {
  bucket: string
  id: string
  name: string
}

type VideoResourcesPageProps = {
  readonly view?: "backup" | "image" | "pool" | "video"
}

export const VideoResourcesPage = ({ view = "pool" }: VideoResourcesPageProps): ReactNode => {
  const { message, modal } = App.useApp()
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
  const tableColumns = useMemo((): TableColumnsType<ShareFile> => {
    if (category !== "image" && category !== "video") return columns
    const next = [...columns]
    next.splice(3, 0, {
      dataIndex: "lastAccount",
      ellipsis: true,
      title: "上次账号",
      width: 160,
    })
    return next
  }, [category])
  const canTransfer = category === "video" || category === "image" || backup
  const [boxes, setBoxes] = useState<ShareBox[]>([])
  const [nasGroups, setNasGroups] = useState<NasGroup[]>([])
  const [nasCards, setNasCards] = useState<NasChoice[]>([])
  const [nasId, setNasId] = useState("")
  const [nasOpen, setNasOpen] = useState(false)
  const [nasDirs, setNasDirs] = useState<readonly string[]>([])
  const [nasDir, setNasDir] = useState("")
  const [nasDirNew, setNasDirNew] = useState("")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [nasSelected, setNasSelected] = useState<readonly string[]>([])
  const [nasWatch, setNasWatch] = useState(false)
  const [open, setOpen] = useState(false)
  const [targetDeviceId, setTargetDeviceId] = useState("")
  const [targetDirectory, setTargetDirectory] = useState("")
  const [sending, setSending] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    const query = backup ? "bucket=backup" : `category=${category}`
    const response = await fetch(`/api/share-files?${query}`, { credentials: "same-origin" })
    if (!response.ok) return
    const body = (await response.json()) as { boxes: ShareBox[]; nas?: NasGroup[] }
    setBoxes(body.boxes)
    setNasGroups(body.nas ?? [])
  }, [backup, category])

  useEffect(() => {
    void load()
  }, [load])

  const nasBucket = category === "image" ? "pictures" : category === "video" ? "videos" : backup ? "backup" : ""
  const canMoveNas = category === "image" || category === "video" || backup
  const canDeleteNas = canMoveNas
  useEffect(() => {
    if (nasBucket.length === 0) return
    let cancelled = false
    const loadCards = async (): Promise<void> => {
      const response = await fetch("/api/storage/configuration", { credentials: "same-origin" })
      if (!response.ok || cancelled) return
      const payload = (await response.json()) as { items?: NasChoice[] }
      const cards = (payload.items ?? []).filter((item) => item.bucket === nasBucket)
      if (cancelled) return
      setNasCards(cards)
      setNasId((current) => (cards.some((item) => item.id === current) ? current : (cards[0]?.id ?? "")))
    }
    void loadCards()
    return () => {
      cancelled = true
    }
  }, [nasBucket])

  const nasFileIds = new Set(nasGroups.flatMap((group) => group.files.map((file) => file.id)))
  const nasChosen = nasSelected.filter((id) => nasFileIds.has(id))
  const nasNoun = backup ? "备份" : category === "image" ? "图片" : "视频"
  const deviceByFile = useMemo(() => {
    const map = new Map<string, string>()
    for (const box of boxes) {
      for (const dir of box.directories) {
        for (const file of dir.files) map.set(file.id, box.deviceId)
      }
    }
    return map
  }, [boxes])
  const openNas = async (): Promise<void> => {
    setNasDir("")
    setNasDirNew("")
    setNasOpen(true)
    const response = await fetch(`/api/share-nas-directories?nasId=${encodeURIComponent(nasId)}`, {
      credentials: "same-origin",
    })
    if (!response.ok) {
      setNasDirs([])
      return
    }
    const body = (await response.json()) as { directories?: string[] }
    setNasDirs(body.directories ?? [])
  }

  const moveToNas = async (directory: string): Promise<void> => {
    const ids = selected.filter((id) => !nasFileIds.has(id))
    const deviceIds = [...new Set(ids.flatMap((id) => {
      const deviceId = deviceByFile.get(id)
      return deviceId === undefined ? [] : [deviceId]
    }))]
    if (nasId.length === 0 || deviceIds.length === 0) return
    setSending(true)
    const scanResponse = await fetch("/api/share-scans", {
      body: JSON.stringify(backup ? { deviceIds, scope: "backup" } : { deviceIds }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    if (!scanResponse.ok) {
      setSending(false)
      message.error("扫描没有下发")
      return
    }
    const scanBody = (await scanResponse.json()) as { scans: ScanReply[] }
    const started = new Set(
      scanBody.scans
        .filter((item) => (item.status === "pending" || item.status === "running") && item.deviceId !== undefined)
        .map((item) => item.deviceId ?? ""),
    )
    if (started.size === 0) {
      setSending(false)
      reportScan(scanBody.scans, message)
      return
    }
    const deadline = Date.now() + 10 * 60 * 1000
    let freshBoxes: ShareBox[] | null = null
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      const response = await fetch(backup ? "/api/share-files?bucket=backup" : `/api/share-files?category=${category}`, {
        credentials: "same-origin",
      })
      if (!response.ok) continue
      const body = (await response.json()) as { boxes: ShareBox[]; nas?: NasGroup[] }
      setBoxes(body.boxes)
      setNasGroups(body.nas ?? [])
      const pending = body.boxes.some(
        (box) => started.has(box.deviceId) && (box.scanStatus === "pending" || box.scanStatus === "running"),
      )
      if (!pending) {
        freshBoxes = body.boxes
        break
      }
    }
    if (freshBoxes === null) {
      setSending(false)
      message.error("扫描还没结束，没有转入 NAS")
      return
    }
    const fileIds: string[] = []
    for (const box of freshBoxes) {
      if (!started.has(box.deviceId) || box.scanStatus === "failed") continue
      for (const dir of box.directories) {
        for (const file of dir.files) {
          if (ids.includes(file.id)) fileIds.push(file.id)
        }
      }
    }
    if (fileIds.length === 0) {
      setSending(false)
      message.error("没有可转入 NAS 的文件")
      return
    }
    const response = await fetch("/api/share-nas-transfers", {
      body: JSON.stringify({ directory, fileIds, nasId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    setSending(false)
    if (!response.ok) {
      message.error("没有转到 NAS")
      return
    }
    message.success("已下发，盒子会先核对再传入 NAS，然后删除盒子上的那一份")
    setSelected([])
  }

  const removeNas = async (): Promise<void> => {
    const response = await fetch("/api/share-nas-deletes", {
      body: JSON.stringify({ fileIds: nasChosen }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      message.error("没有删掉")
      return
    }
    const body = (await response.json()) as { queued?: boolean }
    if (body.queued !== true) {
      message.error("没有在线盒子")
      return
    }
    message.success("已下发，盒子会删掉 NAS 上的文件，然后去掉列表里的记录")
    setNasSelected([])
    setNasWatch(true)
  }

  const askRemoveNas = (): void => {
    modal.confirm({
      cancelText: "取消",
      content: `将删除这 ${nasChosen.length} 个${nasNoun}。NAS 上的文件和表里的记录都会去掉。`,
      okButtonProps: { danger: true },
      okText: "删除",
      onOk: () => removeNas(),
      title: "删除",
    })
  }

  const removeDirectory = async (entryId: string): Promise<void> => {
    const response = await fetch("/api/share-nas-directory-deletes", {
      body: JSON.stringify({ entryId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    if (response.status === 409) {
      message.error("目录里还有备份")
      return
    }
    if (!response.ok) {
      message.error("没有删掉")
      return
    }
    const body = (await response.json()) as { queued?: boolean }
    if (body.queued !== true) {
      message.error("没有在线盒子")
      return
    }
    message.success("已下发，盒子会先删掉目录，确认找不到后再去掉列表里的记录")
    setNasWatch(true)
  }

  const askRemoveDirectory = (entryId: string, name: string): void => {
    modal.confirm({
      cancelText: "取消",
      content: `将删除目录 ${name}。NAS 上的目录和表里的记录都会去掉。`,
      okButtonProps: { danger: true },
      okText: "删除",
      onOk: () => removeDirectory(entryId),
      title: "删除目录",
    })
  }

  useEffect(() => {
    if (!boxes.some((box) => box.scanStatus === "pending" || box.scanStatus === "running")) return
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [boxes, load])

  useEffect(() => {
    if (!nasWatch) return
    const timer = window.setInterval(() => void load(), 3000)
    const stop = window.setTimeout(() => setNasWatch(false), 60000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [load, nasWatch])

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
      body: JSON.stringify({
        fileIds: selected,
        targetDeviceId,
        targetDirectory: targetDirectory.trim(),
      }),
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
      backup
        ? "转移任务已下发，对应盒子领到后会复制文件"
        : "转移任务已下发，对应盒子领到后会搬运文件",
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
            setNasSelected([])
          }}
          tabBarExtraContent={
            <Button loading={scanning} onClick={() => void scan()} type="primary">
              扫描盒子资源
            </Button>
          }
        />
      ) : (
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
          {canDeleteNas && nasChosen.length > 0 ? (
            <Button danger onClick={askRemoveNas}>
              删除
            </Button>
          ) : null}
          {canMoveNas ? (
            <>
              <Select
                aria-label="NAS"
                onChange={setNasId}
                options={nasCards.map((item) => ({ label: `${item.name} · ${item.bucket}`, value: item.id }))}
                placeholder="选择 NAS"
                style={{ width: 220 }}
                value={nasId.length === 0 ? null : nasId}
                virtual={false}
              />
              <Button
                disabled={nasId.length === 0 || selected.filter((id) => !nasFileIds.has(id)).length === 0}
                loading={sending}
                onClick={() => void openNas()}
              >
                转移到 NAS
              </Button>
            </>
          ) : null}
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
      {boxes.length === 0 && nasGroups.length === 0 ? <Empty description="这个管理员名下还没有盒子" /> : null}
      {nasGroups.map((group) => {
        const card = nasCards.find((item) => item.id === group.nasId)
        const grouped = backup ? backupFolders(group.files, group.directories ?? []) : null
        const fileTable = (files: readonly ShareFile[]): ReactNode => (
          <Table
            columns={tableColumns}
            dataSource={[...files]}
            pagination={false}
            rowKey="id"
            {...(canDeleteNas
              ? {
                  rowSelection: filteredRowSelection({
                    onChange: (keys) => setNasSelected(keys.map(String)),
                    rowKey: "id",
                    rows: files,
                    selectedKeys: nasSelected,
                  }),
                }
              : {})}
            size="small"
          />
        )
        return (
          <Collapse
            key={group.nasId}
            items={[
              {
                children:
                  grouped === null ? (
                    fileTable(group.files)
                  ) : (
                    <Space direction="vertical" style={{ display: "flex" }}>
                      {grouped.folders.length === 0 && grouped.loose.length === 0 ? (
                        <Empty description="还没有目录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : null}
                      {grouped.folders.length > 0 ? (
                        <Collapse
                          items={grouped.folders.map((folder) => ({
                            children:
                              folder.files.length === 0 ? (
                                <Empty description="目录是空的" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                              ) : (
                                fileTable(folder.files)
                              ),
                            key: folder.name,
                            label: (
                              <Space>
                                <span>{`${folder.name}（${folder.files.length}）`}</span>
                                {folder.id.length > 0 ? (
                                  <Button
                                    danger
                                    disabled={folder.files.length > 0}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      askRemoveDirectory(folder.id, folder.name)
                                    }}
                                    size="small"
                                  >
                                    删除目录
                                  </Button>
                                ) : null}
                              </Space>
                            ),
                          }))}
                        />
                      ) : null}
                      {grouped.loose.length > 0 ? fileTable(grouped.loose) : null}
                    </Space>
                  ),
                key: group.nasId,
                label: card === undefined ? group.nasId : `${card.name} · ${card.bucket}`,
              },
            ]}
          />
        )
      })}
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
                      columns={tableColumns}
                      dataSource={dir.files}
                      pagination={false}
                      rowKey="id"
                      {...(canTransfer
                        ? {
                            rowSelection: filteredRowSelection({
                              onChange: (keys) => setSelected(keys.map(String)),
                              rowKey: "id",
                              rows: dir.files,
                              selectedKeys: selected,
                            }),
                          }
                        : {})}
                      size="small"
                    />
                  ),
                  key: dir.path || "/",
                  label:
                    dir.path === ""
                      ? `根目录（${dir.files.length}）`
                      : `${dir.path}（${dir.files.length}）`,
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
        okText="转入"
        onCancel={() => setNasOpen(false)}
        onOk={() => {
          const directory = nasDirNew.trim() || nasDir
          if (directory.length === 0) {
            message.error("请选择或新建目录")
            return
          }
          setNasOpen(false)
          void moveToNas(directory)
        }}
        open={nasOpen}
        title="转到 NAS 的目录"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            aria-label="已有目录"
            onChange={setNasDir}
            options={nasDirs.map((item) => ({ label: item, value: item }))}
            placeholder="选择已有目录"
            style={{ width: "100%" }}
            value={nasDir.length === 0 ? null : nasDir}
            virtual={false}
          />
          <Input
            aria-label="新建目录"
            maxLength={80}
            onChange={(event) => setNasDirNew(event.target.value)}
            placeholder="新建目录，例如 短视频"
            value={nasDirNew}
          />
        </Space>
      </Modal>
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
            options={boxes.map((box) => ({
              label: `${box.name || box.host} ${box.host}`,
              value: box.deviceId,
            }))}
            placeholder="目标盒子"
            style={{ width: "100%" }}
            value={targetDeviceId || null}
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

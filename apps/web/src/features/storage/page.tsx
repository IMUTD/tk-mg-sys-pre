import { EditOutlined, PlusOutlined } from "@ant-design/icons"
import { App, Button, Card, Progress, Segmented, Space, Tag } from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import { TargetFormDialog } from "./form-dialog"
import { ScheduleDialog } from "./schedule-dialog"
import "./storage.css"
import {
  advanceBackup,
  type BackupMode,
  type BackupSchedule,
  connectionColor,
  connectionLabel,
  createSeedTargets,
  emptyTarget,
  endpointText,
  filterTargets,
  nowText,
  type StorageKind,
  type StorageTarget,
  scheduleLabel,
  startBackup,
  testConnection,
} from "./storage-target"

type StoragePageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

const BACKUP_TICK_MS = 140

export const StoragePage = ({ canDelete, canWrite }: StoragePageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [kind, setKind] = useState<StorageKind>("nas")
  const [targets, setTargets] = useState<StorageTarget[]>(() => createSeedTargets())
  const [editRecord, setEditRecord] = useState<StorageTarget | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<StorageTarget | null>(null)
  const filtered = useMemo(() => filterTargets(targets, kind), [kind, targets])
  const nextId = Math.max(0, ...targets.map((item) => item.id)) + 1
  const hasRunning = targets.some((item) => item.backup.status === "running")

  useEffect(() => {
    if (!hasRunning) return
    const timer = window.setInterval(() => {
      const stamp = nowText()
      setTargets((current) => current.map((item) => advanceBackup(item, stamp)))
    }, BACKUP_TICK_MS)
    return () => window.clearInterval(timer)
  }, [hasRunning])

  const patchTarget = (id: number, updater: (item: StorageTarget) => StorageTarget): void => {
    setTargets((current) => current.map((item) => (item.id === id ? updater(item) : item)))
  }

  const confirmDelete = (target: StorageTarget): void => {
    void modal.confirm({
      cancelText: "取消",
      content: `确定删除「${target.name}」吗？`,
      okText: "确定",
      onOk: () => {
        setTargets((current) => current.filter((item) => item.id !== target.id))
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const runBackup = (target: StorageTarget, mode: BackupMode): void => {
    if (target.backup.status === "running") {
      message.warning("正在备份中")
      return
    }
    patchTarget(target.id, (item) => startBackup(item, mode))
    message.success(mode === "full" ? "已开始全量备份" : "已开始定时备份")
  }

  const runTest = (target: StorageTarget): void => {
    const result = testConnection(target)
    const stamp = nowText()
    patchTarget(target.id, (item) => ({
      ...item,
      lastTestAt: stamp,
      status: result.ok ? "connected" : "disconnected",
      updateTime: stamp,
    }))
    if (result.ok) message.success(result.message)
    else message.error(result.message)
  }

  const saveSchedule = (target: StorageTarget, schedule: BackupSchedule, runNow: boolean): void => {
    const stamp = nowText()
    patchTarget(target.id, (item) => {
      const next = { ...item, schedule, updateTime: stamp }
      return runNow ? startBackup(next, "scheduled") : next
    })
    setScheduleTarget(null)
    message.success(runNow ? "已保存并开始备份" : "定时备份已保存")
  }

  return (
    <section className="module-page storage-page">
      <div className="storage-kind-bar">
        <Segmented
          onChange={(value) => setKind(value as StorageKind)}
          options={[
            { label: "配置NAS", value: "nas" },
            { label: "配置SQL类型数据库", value: "sql" },
          ]}
          value={kind}
        />
        {canWrite ? (
          <Button
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditRecord(emptyTarget(kind, 0, nowText()))}
            type="primary"
          >
            新增
          </Button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <Card className="storage-empty">{kind === "nas" ? "暂无 NAS 配置" : "暂无数据库配置"}</Card>
      ) : (
        <div className="storage-card-grid">
          {filtered.map((item) => (
            <Card
              className="storage-card"
              extra={
                canWrite || allowDelete ? (
                  <Space size={0}>
                    {canWrite ? (
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        onClick={() => setEditRecord(item)}
                        size="small"
                        type="link"
                      >
                        编辑
                      </Button>
                    ) : null}
                    {allowDelete ? (
                      <Button danger onClick={() => confirmDelete(item)} size="small" type="link">
                        删除
                      </Button>
                    ) : null}
                  </Space>
                ) : null
              }
              key={item.id}
              title={item.name}
            >
              <p className="storage-endpoint">{endpointText(item)}</p>
              <Space wrap>
                <Tag color={connectionColor(item.status)}>{connectionLabel(item.status)}</Tag>
                <Tag>{scheduleLabel(item.schedule)}</Tag>
                {item.backup.status === "success" ? <Tag color="success">最近备份成功</Tag> : null}
                {item.backup.status === "running" ? <Tag color="processing">备份中</Tag> : null}
              </Space>
              <p className="storage-meta">
                上次备份：{item.lastBackupAt.length === 0 ? "暂无" : item.lastBackupAt}
              </p>
              {item.remark.length === 0 ? null : (
                <p className="storage-meta">备注：{item.remark}</p>
              )}
              {item.backup.status === "running" ? (
                <Progress percent={item.backup.percent} size="small" status="active" />
              ) : null}
              {canWrite ? (
                <Space className="storage-card-actions" wrap>
                  <Button onClick={() => runBackup(item, "full")} type="primary">
                    全量备份
                  </Button>
                  <Button onClick={() => setScheduleTarget(item)}>定时备份</Button>
                  <Button onClick={() => runTest(item)}>测试连接</Button>
                </Space>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {editRecord === null ? null : (
        <TargetFormDialog
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) => {
            const stamp = nowText()
            const tested = testConnection(item)
            const saved = {
              ...item,
              lastTestAt: stamp,
              status: tested.ok ? ("connected" as const) : item.status,
              updateTime: stamp,
            }
            if (item.id === 0) {
              setTargets((current) => [{ ...saved, id: nextId }, ...current])
              message.success("新增成功")
            } else {
              setTargets((current) =>
                current.map((entry) => (entry.id === item.id ? saved : entry)),
              )
              message.success("修改成功")
            }
            setEditRecord(null)
          }}
          record={editRecord}
        />
      )}
      {scheduleTarget === null ? null : (
        <ScheduleDialog
          onCancel={() => setScheduleTarget(null)}
          onRun={(schedule) => saveSchedule(scheduleTarget, schedule, true)}
          onSubmit={(schedule) => saveSchedule(scheduleTarget, schedule, false)}
          target={scheduleTarget}
        />
      )}
    </section>
  )
}

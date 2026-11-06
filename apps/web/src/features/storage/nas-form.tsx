import { EditOutlined, PlusOutlined } from "@ant-design/icons"
import { App, Button, Card, Input, Modal, Space } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { NasObjectList } from "./nas-list"
import { type NasCard, probeNasLogin, readNasCards, readNasPrefix } from "./nas-s3"

type NasCardsProps = {
  readonly canDelete: boolean
  readonly canWrite: boolean
}

type Draft = {
  readonly bucket: string
  readonly endpoint: string
  readonly id: string
  readonly loginUrl: string
  readonly name: string
  readonly password: string
  readonly savedPassword: string
  readonly username: string
}

const emptyDraft = (): Draft => ({
  bucket: "",
  endpoint: "",
  id: crypto.randomUUID(),
  loginUrl: "",
  name: "",
  password: "",
  savedPassword: "",
  username: "",
})

const s3Address = (card: Pick<NasCard, "endpoint" | "loginUrl">): string =>
  card.endpoint.length > 0 ? card.endpoint : card.loginUrl

const draftFrom = (card: NasCard): Draft => ({
  bucket: card.bucket,
  endpoint: card.endpoint,
  id: card.id,
  loginUrl: s3Address(card),
  name: card.name,
  password: "",
  savedPassword: card.password,
  username: card.username,
})

export const NasCards = ({ canDelete, canWrite }: NasCardsProps): ReactNode => {
  const { message, modal } = App.useApp()
  const [items, setItems] = useState<readonly NasCard[]>([])
  const [prefix, setPrefix] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [listing, setListing] = useState<NasCard | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const response = await fetch("/api/storage/configuration", { credentials: "same-origin" })
      if (!response.ok || cancelled) return
      const payload: unknown = await response.json()
      setItems(readNasCards(payload))
      setPrefix(readNasPrefix(payload))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const persist = async (next: readonly NasCard[]): Promise<boolean> => {
    const response = await fetch("/api/storage/configuration", {
      body: JSON.stringify({
        items: next.map((item) => ({
          bucket: item.bucket,
          endpoint: item.endpoint,
          id: item.id,
          loginUrl: item.loginUrl,
          name: item.name,
          password: item.password,
          username: item.username,
        })),
      }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
    if (!response.ok) {
      message.error("没有保存")
      return false
    }
    const payload: unknown = await response.json()
    setItems(readNasCards(payload))
    setPrefix(readNasPrefix(payload))
    return true
  }

  const saveDraft = async (): Promise<void> => {
    if (draft === null) return
    const password = draft.password.length > 0 ? draft.password : draft.savedPassword
    if (draft.name.trim().length === 0 || draft.loginUrl.trim().length === 0 || draft.username.trim().length === 0 || password.length === 0 || !/^[a-z0-9-]{3,63}$/.test(draft.bucket.trim())) {
      message.error("名称、地址、用户名、密码、目录都要填")
      return
    }
    const nextCard: NasCard = {
      bucket: draft.bucket.trim(),
      endpoint: draft.endpoint,
      id: draft.id,
      loginUrl: draft.loginUrl.trim(),
      name: draft.name.trim(),
      password,
      prefix: "",
      username: draft.username.trim(),
    }
    const others = items.filter((item) => item.id !== nextCard.id)
    setBusy(true)
    const saved = await persist([...others, nextCard])
    setBusy(false)
    if (saved) {
      setDraft(null)
      message.success("已保存")
    }
  }

  const testDraft = async (): Promise<void> => {
    if (draft === null) return
    const password = draft.password.length > 0 ? draft.password : draft.savedPassword
    setBusy(true)
    const result = await probeNasLogin(draft.loginUrl, draft.username, password, draft.bucket, prefix)
    setBusy(false)
    if (result.ok) {
      setDraft({
        ...draft,
        endpoint: result.endpoint,
        loginUrl: result.endpoint.length > 0 ? result.endpoint : draft.loginUrl,
      })
      message.success(result.message)
      return
    }
    message.error(result.message)
  }

  const testCard = async (card: NasCard): Promise<void> => {
    setBusy(true)
    const result = await probeNasLogin(s3Address(card), card.username, card.password, card.bucket, card.prefix || prefix)
    setBusy(false)
    if (!result.ok) {
      message.error(result.message)
      return
    }
    message.success(result.message)
    const address = result.endpoint.length > 0 ? result.endpoint : s3Address(card)
    if (result.endpoint === card.endpoint && address === card.loginUrl) return
    await persist(items.map((item) => (item.id === card.id ? { ...item, endpoint: address, loginUrl: address } : item)))
  }

  const removeCard = (card: NasCard): void => {
    void modal.confirm({
      cancelText: "取消",
      content: `确定删除「${card.name}」吗？`,
      okText: "确定",
      onOk: () => persist(items.filter((item) => item.id !== card.id)),
      title: "提示",
    })
  }

  return (
    <>
      {canWrite ? (
        <div className="storage-nas-add">
          <Button icon={<PlusOutlined aria-hidden />} onClick={() => setDraft(emptyDraft())} type="primary">
            新增
          </Button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <Card className="storage-empty">暂无 NAS 配置</Card>
      ) : (
        <div className="storage-card-grid">
          {items.map((item) => (
            <Card
              className="storage-card"
              extra={
                canWrite || canDelete ? (
                  <Space size={0}>
                    {canWrite ? (
                      <Button icon={<EditOutlined aria-hidden />} onClick={() => setDraft(draftFrom(item))} size="small" type="link">
                        编辑
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button danger onClick={() => removeCard(item)} size="small" type="link">
                        删除
                      </Button>
                    ) : null}
                  </Space>
                ) : null
              }
              key={item.id}
              title={item.name}
            >
              <p className="storage-endpoint">{s3Address(item)}</p>
              <p className="storage-meta">{item.username} · {item.bucket}</p>
              <Space className="storage-card-actions" wrap>
                <Button disabled={busy} onClick={() => void testCard(item)}>
                  联通测试
                </Button>
                <Button onClick={() => setListing(item)}>数据列表</Button>
                <Button onClick={() => window.open(s3Address(item))}>打开 NAS</Button>
              </Space>
            </Card>
          ))}
        </div>
      )}
      <NasObjectList card={listing} onClose={() => setListing(null)} />
      <Modal
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
        okText="保存"
        onCancel={() => setDraft(null)}
        onOk={() => void saveDraft()}
        open={draft !== null}
        title={draft !== null && draft.savedPassword.length > 0 ? "编辑 NAS" : "新增 NAS"}
      >
        {draft === null ? null : (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input
              aria-label="名称"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="名称"
              value={draft.name}
            />
            <Input
              aria-label="地址"
              onChange={(event) => setDraft({ ...draft, loginUrl: event.target.value })}
              placeholder="http://192.168.76.19:8010"
              value={draft.loginUrl}
            />
            <Input
              aria-label="用户名"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              placeholder="用户名"
              value={draft.username}
            />
            <Input.Password
              aria-label="密码"
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              placeholder={draft.savedPassword.length > 0 ? "留空表示不改" : "密码"}
              value={draft.password}
            />
            <Input
              aria-label="目录"
              onChange={(event) => setDraft({ ...draft, bucket: event.target.value })}
              placeholder="目录，例如 backup"
              value={draft.bucket}
            />
            <Button disabled={busy} onClick={() => void testDraft()}>
              联通测试
            </Button>
          </Space>
        )}
      </Modal>
    </>
  )
}

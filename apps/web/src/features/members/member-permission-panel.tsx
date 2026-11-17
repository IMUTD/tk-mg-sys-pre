import { Alert, App, Button, Modal, Switch, Table, Typography } from "antd"
import type { ColumnsType } from "antd/es/table"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"

import { ADMIN_ONLY_PAGE_KEYS, isDeleteLockedPath, PAGE_CATALOG } from "../../lib/pages"
import type { Member, MembersApi, PageAccess } from "./api"

type MemberPermissionPanelProps = {
  readonly api: MembersApi
  readonly member: Member
  readonly onClose: () => void
}

type Row = {
  readonly canDelete: boolean
  readonly canView: boolean
  readonly group: string
  readonly key: string
  readonly label: string
}

export const MemberPermissionPanel = ({
  api,
  member,
  onClose,
}: MemberPermissionPanelProps): ReactNode => {
  const { message } = App.useApp()
  const readOnly = member.role === "administrator"
  const [pages, setPages] = useState<readonly PageAccess[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async (): Promise<void> => {
    setError(false)
    setLoading(true)
    try {
      setPages(await api.listMemberPermissions(member.id))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [api, member.id])
  useEffect(() => {
    void load()
  }, [load])
  const rows = useMemo<readonly Row[]>(
    () =>
      PAGE_CATALOG.filter((page) => !ADMIN_ONLY_PAGE_KEYS.includes(page.key)).map((page) => {
        const access = pages.find((item) => item.key === page.key)
        return {
          canDelete: access?.canDelete ?? false,
          canView: access?.canView ?? false,
          group: page.group,
          key: page.key,
          label: page.label,
        }
      }),
    [pages],
  )
  const patch = (key: string, next: Partial<Pick<Row, "canDelete" | "canView">>): void => {
    if (readOnly) return
    setPages((current) =>
      PAGE_CATALOG.map((page) => {
        const existing = current.find((item) => item.key === page.key) ?? {
          canDelete: false,
          canView: false,
          key: page.key,
        }
        if (page.key !== key) return existing
        const canView = next.canView ?? existing.canView
        const canDelete =
          canView && !isDeleteLockedPath(page.key) && (next.canDelete ?? existing.canDelete)
        return { canDelete, canView, key: page.key }
      }),
    )
  }
  const save = async (): Promise<void> => {
    if (readOnly) return
    setSaving(true)
    setError(false)
    try {
      setPages(await api.replaceMemberPermissions(member.id, pages))
      message.success("成员权限已保存")
      onClose()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  const columns: ColumnsType<Row> = [
    { dataIndex: "group", key: "group", title: "分组", width: 120 },
    { dataIndex: "label", key: "label", title: "页面" },
    { dataIndex: "key", ellipsis: true, key: "path", title: "路径", width: 240 },
    {
      align: "center",
      key: "view",
      render: (_value, row) => (
        <Switch
          aria-label={`${row.label}可查看`}
          checked={row.canView}
          disabled={readOnly}
          onChange={(canView) => patch(row.key, { canView })}
          size="small"
        />
      ),
      title: "可查看",
      width: 100,
    },
    {
      align: "center",
      key: "delete",
      render: (_value, row) => (
        <Switch
          aria-label={`${row.label}可删除`}
          checked={row.canDelete}
          disabled={readOnly || !row.canView || isDeleteLockedPath(row.key)}
          onChange={(canDelete) => patch(row.key, { canDelete })}
          size="small"
        />
      ),
      title: "可删除",
      width: 100,
    },
  ]
  const title = `成员权限 · ${member.displayName}`
  return (
    <Modal
      aria-label={title}
      destroyOnHidden
      footer={
        <div className="dialog-actions">
          <Button onClick={onClose}>取消</Button>
          {readOnly ? null : (
            <Button loading={saving} onClick={() => void save()} type="primary">
              保存权限
            </Button>
          )}
        </div>
      }
      onCancel={onClose}
      open
      title={title}
      width={880}
    >
      <Typography.Paragraph type="secondary">
        {readOnly
          ? "管理员始终拥有全部页面权限，不能微调。"
          : "该成员创建时已写入角色默认权限，可在此微调最终权限。成员与权限、工作日志仅管理员可见；运营概览不能开删除。"}
      </Typography.Paragraph>
      {error ? (
        <Alert className="form-error" message="成员权限保存或加载失败" showIcon type="error" />
      ) : null}
      <Table
        columns={columns}
        dataSource={[...rows]}
        loading={loading}
        pagination={false}
        rowKey="key"
        size="small"
      />
    </Modal>
  )
}

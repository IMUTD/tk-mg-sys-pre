import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Input,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Typography,
} from "antd"
import { type ReactNode, useMemo, useState } from "react"

import { MEMBER_ROLE_OPTIONS, ROLE_LABELS } from "../../lib/pages"
import { useAuth } from "../auth/auth-provider"
import {
  createMembersApi,
  type Member,
  type MemberCreate,
  type MembersApi,
  type MemberUpdate,
} from "./api"
import { MemberDialog } from "./member-dialog"
import { MemberPermissionPanel } from "./member-permission-panel"

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value)
    return
  }
  const area = document.createElement("textarea")
  area.value = value
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.left = "-9999px"
  document.body.append(area)
  area.select()
  const copied = document.execCommand("copy")
  area.remove()
  if (!copied) throw new Error("copy_failed")
}

const CopyCell = ({
  emptyLabel = "—",
  label,
  onCopy,
  value,
}: {
  readonly emptyLabel?: string
  readonly label: string
  readonly onCopy: (value: string, label: string) => void
  readonly value: string | null
}): ReactNode => {
  if (value === null || value.length === 0) return emptyLabel
  return (
    <Typography.Text
      aria-label={`复制${label} ${value}`}
      copyable={false}
      onClick={() => onCopy(value, label)}
      style={{ cursor: "pointer" }}
      title={`点击复制${label}`}
    >
      {value}
    </Typography.Text>
  )
}

const columns = (
  onCopy: (value: string, label: string) => void,
  onEdit: (member: Member) => void,
  onPermissions: (member: Member) => void,
  onDelete: (member: Member) => void,
  currentUserId: string | undefined,
): TableColumnsType<Member> => [
  { dataIndex: "displayName", ellipsis: true, key: "displayName", title: "名字", width: 120 },
  {
    ellipsis: true,
    key: "email",
    render: (_value: unknown, member: Member) => (
      <CopyCell label="账号" onCopy={onCopy} value={member.email} />
    ),
    title: "账号",
    width: 240,
  },
  {
    key: "role",
    render: (_value: unknown, member: Member) => ROLE_LABELS[member.role] ?? member.role,
    title: "角色",
    width: 120,
  },
  {
    key: "status",
    render: (_value: unknown, member: Member) => (member.enabled ? "启用" : "停用"),
    title: "状态",
    width: 80,
  },
  {
    align: "center",
    key: "permissions",
    render: (_value: unknown, member: Member) =>
      member.role === "administrator" ? (
        "全部权限"
      ) : (
        <Button
          aria-label={`配置 ${member.displayName} 的成员权限`}
          onClick={() => onPermissions(member)}
          size="small"
          type="link"
        >
          成员权限
        </Button>
      ),
    title: "成员权限",
    width: 110,
  },
  {
    align: "center",
    fixed: "right",
    key: "actions",
    render: (_value: unknown, member: Member) =>
      member.role === "administrator" ? null : (
      <Space size={0}>
        <Button
          aria-label={`编辑 ${member.displayName}`}
          onClick={() => onEdit(member)}
          size="small"
          type="link"
        >
          编辑
        </Button>
        <Button
          aria-label={`删除 ${member.displayName}`}
          danger
          disabled={member.id === currentUserId}
          onClick={() => onDelete(member)}
          size="small"
          type="link"
        >
          删除
        </Button>
      </Space>
    ),
    title: "操作",
    width: 120,
  },
]

type MemberPageProps = { readonly api?: MembersApi }

export const MemberPage = ({ api: suppliedApi }: MemberPageProps): ReactNode => {
  const api = useMemo(() => suppliedApi ?? createMembersApi(), [suppliedApi])
  const { message, modal } = App.useApp()
  const { session } = useAuth()
  const currentUserId = session.kind === "authenticated" ? session.user.userId : undefined
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Member | null | undefined>(undefined)
  const [permissionsMember, setPermissionsMember] = useState<Member>()
  const [keyword, setKeyword] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>()
  const [statusFilter, setStatusFilter] = useState<string>()
  const members = useQuery({ queryFn: api.list, queryKey: ["members"] })
  const copyValue = (value: string, label: string): void => {
    void copyText(value).then(
      () => {
        message.success(`已复制${label}`)
      },
      () => {
        message.error(`复制${label}失败`)
      },
    )
  }
  const create = useMutation({
    mutationFn: api.create,
    onSuccess: async () => {
      setEditing(undefined)
      message.success("成员已创建")
      await queryClient.invalidateQueries({ queryKey: ["members"] })
    },
  })
  const update = useMutation({
    mutationFn: ({
      input,
      memberId,
    }: {
      readonly input: MemberUpdate
      readonly memberId: string
    }) => api.update(memberId, input),
    onSuccess: async () => {
      setEditing(undefined)
      message.success("成员已保存")
      await queryClient.invalidateQueries({ queryKey: ["members"] })
    },
  })
  const remove = useMutation({
    mutationFn: api.delete,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["members"] })
    },
  })
  const confirmDelete = (member: Member): void => {
    void modal.confirm({
      cancelText: "取消",
      content: `确定删除成员「${member.displayName}」吗？删除后无法登录。若该成员已有业务记录，请改为停用。`,
      okText: "删除",
      okType: "danger",
      onOk: () => remove.mutateAsync(member.id),
      title: "删除成员",
    })
  }
  const rows = useMemo(() => {
    const keywordText = keyword.trim().toLowerCase()
    return (members.data ?? []).filter((member) => {
      if (
        keywordText.length > 0 &&
        !member.email.toLowerCase().includes(keywordText) &&
        !member.displayName.toLowerCase().includes(keywordText)
      ) {
        return false
      }
      if (roleFilter !== undefined && member.role !== roleFilter) return false
      if (statusFilter === "enabled" && !member.enabled) return false
      if (statusFilter === "disabled" && member.enabled) return false
      return true
    })
  }, [keyword, members.data, roleFilter, statusFilter])
  const dialogError =
    (create.error instanceof Error ? create.error.message : undefined) ??
    (update.error instanceof Error ? update.error.message : undefined)
  return (
    <section className="module-page">
      <div className="page-toolbar">
        <Typography.Paragraph type="secondary">
          仅管理员可进入。新建成员会随机分配名字，并写入该角色的默认页面权限；创建后再从「成员权限」微调最终权限。密码只能通过重置更新，不会保存可查看副本。
        </Typography.Paragraph>
        <Button onClick={() => setEditing(null)} type="primary">
          新建成员
        </Button>
      </div>
      <Space className="filter-bar" wrap>
        <Input.Search
          allowClear
          aria-label="搜索成员"
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索名字或账号"
          style={{ width: 220 }}
          value={keyword}
        />
        <Select
          allowClear
          aria-label="筛选角色"
          onChange={setRoleFilter}
          options={[...MEMBER_ROLE_OPTIONS]}
          placeholder="全部角色"
          style={{ width: 160 }}
          value={roleFilter}
        />
        <Select
          allowClear
          aria-label="筛选状态"
          onChange={setStatusFilter}
          options={[
            { label: "启用", value: "enabled" },
            { label: "停用", value: "disabled" },
          ]}
          placeholder="全部状态"
          style={{ width: 140 }}
          value={statusFilter}
        />
      </Space>
      {members.error === null && remove.error === null ? null : (
        <Alert
          className="form-error"
          message={
            remove.error instanceof Error
              ? remove.error.message
              : members.error instanceof Error
                ? members.error.message
                : "成员列表加载失败"
          }
          showIcon
          type="error"
        />
      )}
      <Table
        columns={columns(
          copyValue,
          (member) => setEditing(member),
          setPermissionsMember,
          confirmDelete,
          currentUserId,
        )}
        dataSource={[...rows]}
        loading={members.isLoading}
        locale={{ emptyText: "暂无成员" }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editing === undefined ? null : (
        <MemberDialog
          api={api}
          {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
          member={editing}
          onClose={() => {
            create.reset()
            update.reset()
            setEditing(undefined)
          }}
          onCreate={(input: MemberCreate) => {
            create.reset()
            create.mutate(input)
          }}
          onUpdate={(input) => {
            if (editing === null) return
            update.reset()
            update.mutate({ input, memberId: editing.id })
          }}
          submitting={create.isPending || update.isPending}
        />
      )}
      {permissionsMember === undefined ? null : (
        <MemberPermissionPanel
          api={api}
          member={permissionsMember}
          onClose={() => setPermissionsMember(undefined)}
        />
      )}
    </section>
  )
}

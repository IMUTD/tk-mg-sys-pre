import { useQuery } from "@tanstack/react-query"
import { Alert, Button, Card, Input, Select, Space, Typography } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import type { ManagedRecord, OperationsDataApi } from "./api"
import { type CreateField, ManagementDialog } from "./management-dialog"
import { ManagementTable } from "./management-table"

export type ManagementPageProps = {
  readonly api: OperationsDataApi
  readonly canWrite: boolean
  readonly createButtonLabel?: string
  readonly createFields: readonly CreateField[]
  readonly defaultStatus: string
  readonly description: string
  readonly groupIds: readonly string[]
  readonly identityTitle?: string
  readonly nameTitle?: string
  readonly onGroupChange?: ((groupId: string) => void) | undefined
  readonly statusOptions: readonly { readonly label: string; readonly value: string }[]
  readonly statusTitle?: string
  readonly title: string
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "操作失败，请稍后重试"

export const ManagementPage = ({
  api,
  canWrite,
  createButtonLabel,
  createFields,
  defaultStatus,
  description,
  groupIds,
  identityTitle = "标识",
  nameTitle = "名称",
  onGroupChange,
  statusOptions,
  statusTitle = "状态",
  title,
}: ManagementPageProps): ReactNode => {
  const buttonLabel = createButtonLabel ?? `新建${title}`
  const [groupId, setGroupId] = useState(groupIds[0] ?? "")
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [dialogRecord, setDialogRecord] = useState<ManagedRecord | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const input = useMemo(
    () => ({
      groupId,
      page,
      pageSize: 20,
      ...(query.length === 0 ? {} : { query }),
      ...(status.length === 0 ? {} : { status }),
    }),
    [groupId, page, query, status],
  )
  const records = useQuery({
    enabled: groupId.length > 0,
    queryFn: () => api.list(input),
    queryKey: ["operations-data", title, input],
  })
  const deleteSelected = async (): Promise<void> => {
    if (selectedIds.size === 0 || !window.confirm(`确认删除选中的${title}吗？`)) return
    setError(null)
    try {
      await api.delete(groupId, [...selectedIds])
      setSelectedIds(new Set())
      await records.refetch()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }
  const search = (): void => {
    setQuery(draftQuery)
    setPage(1)
  }
  const reset = (): void => {
    setDraftQuery("")
    setQuery("")
    setStatus("")
    setPage(1)
  }
  return (
    <section className="module-page">
      <div className="page-toolbar">
        <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
        {canWrite ? (
          <Button onClick={() => setDialogRecord(null)} type="primary">
            {buttonLabel}
          </Button>
        ) : null}
      </div>
      <Card className="filter-bar" size="small">
        <Space wrap>
          <span>
            分组
            <Select
              aria-label={`${title}分组`}
              onChange={(value: string) => {
                setGroupId(value)
                onGroupChange?.(value)
                setPage(1)
                setSelectedIds(new Set())
              }}
              options={groupIds.map((id) => ({ label: id, value: id }))}
              style={{ marginLeft: 8, minWidth: 240 }}
              value={groupId.length === 0 ? null : groupId}
              virtual={false}
            />
          </span>
          <Input
            allowClear
            aria-label={`搜索${title}`}
            onChange={(event) => setDraftQuery(event.target.value)}
            onPressEnter={search}
            placeholder="搜索名称、标识或分组"
            style={{ width: 220 }}
            value={draftQuery}
          />
          <Select
            allowClear
            aria-label={`${title}状态`}
            onChange={(value: string | null) => {
              setStatus(value ?? "")
              setPage(1)
            }}
            options={statusOptions.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            placeholder="全部状态"
            style={{ minWidth: 140 }}
            value={status.length === 0 ? null : status}
            virtual={false}
          />
          <Button onClick={search} type="primary">
            查询
          </Button>
          <Button onClick={reset}>重置</Button>
        </Space>
      </Card>
      {canWrite ? (
        <div className="resource-batch-toolbar">
          <span>已选择 {selectedIds.size} 条</span>
          <Button
            danger
            disabled={selectedIds.size === 0}
            onClick={() => void deleteSelected()}
            type="primary"
          >
            批量删除
          </Button>
        </div>
      ) : null}
      {error === null ? null : (
        <Alert className="form-error" message={error} showIcon type="error" />
      )}
      {records.isPending ? <p>正在加载{title}…</p> : null}
      {records.isError ? (
        <Alert className="form-error" message={errorMessage(records.error)} showIcon type="error" />
      ) : null}
      {records.data === undefined ? null : (
        <ManagementTable
          canWrite={canWrite}
          identityTitle={identityTitle}
          nameTitle={nameTitle}
          onEdit={setDialogRecord}
          onPageChange={setPage}
          onSelectedChange={setSelectedIds}
          page={records.data}
          selectedIds={selectedIds}
          statusOptions={statusOptions}
          statusTitle={statusTitle}
          title={title}
        />
      )}
      {dialogRecord === undefined ? null : (
        <ManagementDialog
          defaultStatus={defaultStatus}
          fields={createFields}
          onClose={() => setDialogRecord(undefined)}
          onSave={async (saveInput) => {
            if (dialogRecord === null) await api.create(groupId, saveInput)
            else await api.update(groupId, dialogRecord.id, saveInput)
            await records.refetch()
          }}
          record={dialogRecord}
          statusOptions={statusOptions}
          tagsLabel="分组"
          title={title}
        />
      )}
    </section>
  )
}

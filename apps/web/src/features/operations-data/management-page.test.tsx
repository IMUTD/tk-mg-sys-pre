import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { ManagedRecord, OperationsDataApi } from "./api"
import { ManagementPage } from "./management-page"

const groupId = "11111111-1111-4111-8111-111111111111"
const recordId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("ManagementPage", { timeout: 30_000 }, () => {
  it("edits resource category, status, tags, and note", async () => {
    // Given
    const updates: Array<Readonly<Record<string, string | readonly string[]>>> = []
    const user = userEvent.setup()
    renderManagementPage({
      api: recordingApi(resource, updates),
      createFields: [
        { label: "资源名称", name: "name", required: true },
        { label: "资源分类", name: "category", required: true },
      ],
      record: resource,
      statusOptions: [
        { label: "可用", value: "available" },
        { label: "停用", value: "inactive" },
      ],
      title: "资源池",
    })
    await screen.findByText("资源一")

    // When
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.clear(screen.getByLabelText("资源分类"))
    await user.type(screen.getByLabelText("资源分类"), "短信")
    await user.selectOptions(screen.getByLabelText("状态"), "inactive")
    await user.clear(screen.getByLabelText("标签"))
    await user.type(screen.getByLabelText("标签"), "批次")
    await user.clear(screen.getByLabelText("备注"))
    await user.type(screen.getByLabelText("备注"), "下线")
    await user.click(screen.getByRole("button", { name: "保存" }))

    // Then
    expect(updates[0]).toEqual({
      category: "短信",
      name: "资源一",
      note: "下线",
      status: "inactive",
      tags: ["批次"],
    })
  }, 30_000)

  it("edits account identifier, status, and secret", async () => {
    // Given
    const updates: Array<Readonly<Record<string, string | readonly string[]>>> = []
    const api: OperationsDataApi = {
      create: async () => account,
      delete: async () => 0,
      list: async () => ({ items: [account], page: 1, pageSize: 20, total: 1 }),
      update: async (_groupId, _id, input) => {
        updates.push(input)
        return account
      },
    }
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <ManagementPage
            api={api}
            canWrite
            createFields={[
              { label: "账号名称", name: "name", required: true },
              { label: "账号标识", name: "identifier", required: true },
              { label: "账号密钥", name: "secret", secret: true, type: "password" },
            ]}
            defaultStatus="ready"
            description="账号管理"
            groupIds={[groupId]}
            statusOptions={[
              { label: "可用", value: "ready" },
              { label: "暂停", value: "suspended" },
            ]}
            title="账号管理"
          />
        </QueryClientProvider>
      </AntdApp>,
    )
    await screen.findByText("账号一")

    // When
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.clear(screen.getByLabelText("账号标识"))
    await user.type(screen.getByLabelText("账号标识"), "changed@example.com")
    await user.selectOptions(screen.getByLabelText("状态"), "suspended")
    await user.clear(screen.getByLabelText("标签"))
    await user.type(screen.getByLabelText("标签"), "A，B")
    await user.clear(screen.getByLabelText("备注"))
    await user.type(screen.getByLabelText("备注"), "更新备注")
    await user.type(screen.getByLabelText("账号密钥"), "rotated-account-secret")
    await user.click(screen.getByRole("button", { name: "保存" }))

    // Then
    expect(updates).toEqual([
      {
        identifier: "changed@example.com",
        name: "账号一",
        note: "更新备注",
        secret: "rotated-account-secret",
        status: "suspended",
        tags: ["A", "B"],
      },
    ])
  })

  it("does not replace an account secret when its edit field is left blank", async () => {
    // Given
    const updates: Array<Readonly<Record<string, string | readonly string[]>>> = []
    const user = userEvent.setup()
    renderManagementPage({
      api: recordingApi(account, updates),
      createFields: [
        { label: "账号名称", name: "name", required: true },
        { label: "账号标识", name: "identifier", required: true },
        { label: "账号密钥", name: "secret", secret: true, type: "password" },
      ],
      record: account,
      statusOptions: [
        { label: "可用", value: "ready" },
        { label: "暂停", value: "suspended" },
      ],
      title: "账号管理",
    })
    await screen.findByText("账号一")

    // When
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存" }))

    // Then
    expect(updates[0]).not.toHaveProperty("secret")
  })

  it("edits proxy endpoint, status, and credentials", async () => {
    // Given
    const updates: Array<Readonly<Record<string, string | readonly string[]>>> = []
    const user = userEvent.setup()
    renderManagementPage({
      api: recordingApi(proxy, updates),
      createFields: [
        { label: "代理名称", name: "name", required: true },
        { label: "地址", name: "endpoint", required: true },
        { label: "代理凭证", name: "credentials", secret: true, type: "password" },
      ],
      record: proxy,
      statusOptions: [
        { label: "可用", value: "ready" },
        { label: "不可用", value: "unavailable" },
      ],
      title: "代理管理",
    })
    await screen.findByText("代理一")

    // When
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.clear(screen.getByLabelText("地址"))
    await user.type(screen.getByLabelText("地址"), "10.0.0.9:8080")
    await user.selectOptions(screen.getByLabelText("状态"), "unavailable")
    await user.type(screen.getByLabelText("代理凭证"), "rotated-secret")
    await user.click(screen.getByRole("button", { name: "保存" }))

    // Then
    expect(updates[0]).toEqual({
      credentials: "rotated-secret",
      endpoint: "10.0.0.9:8080",
      name: "代理一",
      note: "",
      status: "unavailable",
      tags: [],
    })
  })
})

const renderManagementPage = ({
  api,
  createFields,
  record,
  statusOptions,
  title,
}: {
  readonly api: OperationsDataApi
  readonly createFields: Parameters<typeof ManagementPage>[0]["createFields"]
  readonly record: ManagedRecord
  readonly statusOptions: Parameters<typeof ManagementPage>[0]["statusOptions"]
  readonly title: string
}): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <ManagementPage
          api={api}
          canWrite
          createFields={createFields}
          defaultStatus={record.status}
          description={title}
          groupIds={[groupId]}
          statusOptions={statusOptions}
          title={title}
        />
      </QueryClientProvider>
    </AntdApp>,
  )
}

const recordingApi = (
  record: ManagedRecord,
  updates: Array<Readonly<Record<string, string | readonly string[]>>>,
): OperationsDataApi => ({
  create: async () => record,
  delete: async () => 0,
  list: async () => ({ items: [record], page: 1, pageSize: 20, total: 1 }),
  update: async (_groupId, _id, input) => {
    updates.push(input)
    return record
  },
})

const account = {
  credentialState: "configured" as const,
  groupId,
  id: recordId,
  identifier: "account@example.com",
  name: "账号一",
  note: "原备注",
  status: "ready",
  tags: ["旧标签"],
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

const resource = {
  category: "邮箱",
  groupId,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "资源一",
  note: "原备注",
  status: "available",
  tags: ["旧标签"],
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

const proxy = {
  credentialState: "configured" as const,
  endpoint: "10.0.0.5:8080",
  groupId,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "代理一",
  note: "",
  status: "ready",
  tags: [],
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

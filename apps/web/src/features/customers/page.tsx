import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input, Modal, Space, Table, Tag, Typography } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import { type Customer, type CustomerCreate, type CustomersApi, createCustomersApi } from "./api"

const formatTime = (value: Date): string => value.toLocaleString("zh-CN", { hour12: false })

type CreateValues = CustomerCreate & { readonly confirm: string }

/** 平台方建客户方（管理员）；客户方再到初始化工具里建盒子管理员。 */
export const CustomerPage = ({ api: suppliedApi }: { readonly api?: CustomersApi }): ReactNode => {
  const api = useMemo(() => suppliedApi ?? createCustomersApi(), [suppliedApi])
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<Customer>()
  const [createForm] = Form.useForm<CreateValues>()
  const [resetForm] = Form.useForm<{ readonly password: string }>()
  const customers = useQuery({ queryFn: api.list, queryKey: ["customers"] })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customers"] })

  const create = useMutation({
    mutationFn: api.create,
    onSuccess: async () => {
      setCreating(false)
      createForm.resetFields()
      message.success("客户已创建")
      await refresh()
    },
  })
  const update = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      readonly id: string
      readonly input: { enabled?: boolean; password?: string }
    }) => api.update(id, input),
    onSuccess: async () => {
      await refresh()
    },
  })

  const toggle = (customer: Customer): void => {
    const enabled = !customer.enabled
    void modal.confirm({
      cancelText: "取消",
      content: enabled
        ? `启用后「${customer.displayName}」可以再登录管理系统和初始化工具。`
        : `停用后「${customer.displayName}」会立即退出，不能再登录管理系统和初始化工具；名下盒子管理员不受影响。`,
      okText: enabled ? "启用" : "停用",
      ...(enabled ? {} : { okType: "danger" as const }),
      onOk: async () => {
        await update.mutateAsync({ id: customer.id, input: { enabled } })
        message.success(enabled ? "已启用" : "已停用")
      },
      title: enabled ? "启用客户" : "停用客户",
    })
  }

  const error = customers.error ?? update.error
  return (
    <section className="module-page">
      <div className="page-toolbar">
        <Typography.Paragraph type="secondary">
          仅平台方可见。这里创建的是客户方（管理员），可以登录管理系统、积分商场和初始化工具；
          客户方在初始化工具里创建盒子管理员（一级用户），盒子管理员再到「成员与权限」创建二级用户。
        </Typography.Paragraph>
        <Button onClick={() => setCreating(true)} type="primary">
          新建客户
        </Button>
      </div>
      {error === null ? null : (
        <Alert
          className="form-error"
          message={error instanceof Error ? error.message : "客户列表加载失败"}
          showIcon
          type="error"
        />
      )}
      <Table<Customer>
        columns={[
          { dataIndex: "displayName", ellipsis: true, title: "客户名称", width: 160 },
          { dataIndex: "email", ellipsis: true, title: "登录邮箱", width: 240 },
          { dataIndex: "boxAdminCount", title: "盒子管理员", width: 110 },
          { dataIndex: "boxCount", title: "盒子数", width: 90 },
          {
            dataIndex: "enabled",
            render: (enabled: boolean) =>
              enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
            title: "状态",
            width: 80,
          },
          { dataIndex: "createdAt", render: formatTime, title: "创建时间", width: 180 },
          {
            align: "center",
            fixed: "right",
            key: "actions",
            render: (_value: unknown, customer: Customer) => (
              <Space size={0}>
                <Button
                  aria-label={`重置 ${customer.displayName} 的密码`}
                  onClick={() => setResetting(customer)}
                  size="small"
                  type="link"
                >
                  重置密码
                </Button>
                <Button
                  aria-label={`${customer.enabled ? "停用" : "启用"} ${customer.displayName}`}
                  danger={customer.enabled}
                  onClick={() => toggle(customer)}
                  size="small"
                  type="link"
                >
                  {customer.enabled ? "停用" : "启用"}
                </Button>
              </Space>
            ),
            title: "操作",
            width: 150,
          },
        ]}
        dataSource={[...(customers.data ?? [])]}
        loading={customers.isLoading}
        locale={{ emptyText: "还没有客户" }}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 个客户` }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      <Modal
        confirmLoading={create.isPending}
        destroyOnHidden
        okText="创建"
        onCancel={() => {
          setCreating(false)
          create.reset()
        }}
        onOk={() => createForm.submit()}
        open={creating}
        title="新建客户"
      >
        {create.error instanceof Error ? (
          <Alert className="form-error" message={create.error.message} showIcon type="error" />
        ) : null}
        <Form<CreateValues>
          form={createForm}
          layout="vertical"
          onFinish={({ confirm: _confirm, ...input }) => {
            create.reset()
            create.mutate(input)
          }}
        >
          <Form.Item
            extra="同时会建一个同名分组，客户方的积分记在这个分组上"
            label="客户名称"
            name="displayName"
            rules={[{ max: 40, required: true, whitespace: true }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="登录邮箱" name="email" rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="登录密码"
            name="password"
            rules={[{ max: 128, message: "密码至少 8 位", min: 8, required: true }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            dependencies={["password"]}
            label="确认密码"
            name="confirm"
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: async (_rule, value) => {
                  if (value !== getFieldValue("password")) throw new Error("两次输入的密码不一致")
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        confirmLoading={update.isPending}
        destroyOnHidden
        okText="重置"
        onCancel={() => setResetting(undefined)}
        onOk={() => resetForm.submit()}
        open={resetting !== undefined}
        title={`重置「${resetting?.displayName ?? ""}」的密码`}
      >
        <Form<{ readonly password: string }>
          form={resetForm}
          layout="vertical"
          onFinish={async ({ password }) => {
            if (resetting === undefined) return
            await update.mutateAsync({ id: resetting.id, input: { password } })
            setResetting(undefined)
            resetForm.resetFields()
            message.success("密码已重置，客户需要用新密码重新登录")
          }}
        >
          <Form.Item
            label="新密码"
            name="password"
            rules={[{ max: 128, message: "密码至少 8 位", min: 8, required: true }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  )
}

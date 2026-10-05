import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  type BackgroundJob,
  createSeedJobs,
  emptyJob,
  JOB_STATUS_OPTIONS,
  jobStats,
  jobStatusColor,
  jobStatusLabel,
} from "./catalog"
import "../mall/mall.css"

const columns = (
  onStart: (job: BackgroundJob) => void,
  onStop: (job: BackgroundJob) => void,
): TableColumnsType<BackgroundJob> => [
  { dataIndex: "id", title: "任务ID", width: 90 },
  { dataIndex: "name", title: "任务名称" },
  {
    dataIndex: "status",
    render: (value: BackgroundJob["status"]) => (
      <Tag color={jobStatusColor(value)}>{jobStatusLabel(value)}</Tag>
    ),
    title: "状态",
    width: 90,
  },
  {
    dataIndex: "progress",
    render: (value: number) => <Progress percent={value} size="small" />,
    title: "进度",
    width: 160,
  },
  { dataIndex: "createdAt", title: "创建时间", width: 170 },
  { dataIndex: "startedAt", title: "开始时间", width: 170 },
  { dataIndex: "finishedAt", title: "完成时间", width: 170 },
  {
    align: "center",
    fixed: "right",
    key: "action",
    render: (_value: unknown, row: BackgroundJob) => (
      <Space>
        <Button size="small" type="link">
          详情
        </Button>
        <Button onClick={() => onStart(row)} size="small" type="link">
          启动
        </Button>
        <Button onClick={() => onStop(row)} size="small" type="link">
          终止
        </Button>
      </Space>
    ),
    title: "操作",
    width: 180,
  },
]

export const BackgroundJobsPage = (): ReactNode => {
  const { message } = App.useApp()
  const [jobs, setJobs] = useState(createSeedJobs)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState("")
  const filtered = useMemo(
    () => (status.length === 0 ? jobs : jobs.filter((item) => item.status === status)),
    [jobs, status],
  )
  const stats = jobStats(jobs)

  return (
    <section className="module-page jobs-page">
      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic className="job-stat" title="总任务数" value={stats.total} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="运行中" value={stats.running} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="排队中" value={stats.queued} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="草稿" value={stats.draft} />
          </Card>
        </Col>
      </Row>
      <Card size="small">
        <Space wrap>
          <Button onClick={() => setCreating(true)} type="primary">
            添加后台任务
          </Button>
          <Button onClick={() => message.success("已刷新")}>刷新列表</Button>
          <Select
            allowClear
            aria-label="状态"
            onChange={(value) => setStatus(value ?? "")}
            options={[...JOB_STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={status.length === 0 ? null : status}
            virtual={false}
          />
          <Button type="primary">查询</Button>
          <Button onClick={() => setStatus("")}>重置</Button>
        </Space>
      </Card>
      <Table
        columns={columns(
          (job) => {
            setJobs((current) =>
              current.map((item) =>
                item.id === job.id
                  ? { ...item, progress: 12, startedAt: "2026-09-17 19:31:00", status: "running" }
                  : item,
              ),
            )
            message.success("已启动")
          },
          (job) => {
            setJobs((current) =>
              current.map((item) => (item.id === job.id ? { ...item, status: "stopped" } : item)),
            )
            message.success("已终止")
          },
        )}
        dataSource={filtered}
        pagination={false}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {creating ? (
        <JobDialog
          onCancel={() => setCreating(false)}
          onSubmit={(job) => {
            setJobs((current) => [job, ...current])
            setCreating(false)
            message.success("新增成功")
          }}
          record={emptyJob(Math.max(0, ...jobs.map((item) => item.id)) + 1)}
        />
      ) : null}
    </section>
  )
}

const JobDialog = ({
  onCancel,
  onSubmit,
  record,
}: {
  readonly onCancel: () => void
  readonly onSubmit: (job: BackgroundJob) => void
  readonly record: BackgroundJob
}): ReactNode => {
  const { message } = App.useApp()
  const [name, setName] = useState(record.name)

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button
            onClick={() => {
              if (name.trim().length === 0) {
                message.error("请填写任务名称")
                return
              }
              onSubmit({ ...record, name: name.trim() })
            }}
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="添加后台任务"
    >
      <Form layout="horizontal" size="small">
        <Form.Item label="任务名称" required>
          <Input
            aria-label="任务名称"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

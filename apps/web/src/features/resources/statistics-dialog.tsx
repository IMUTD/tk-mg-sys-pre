import { Button, Modal, Table } from "antd"
import type { ReactNode } from "react"

import type { MaterialTagStatistic } from "./myt-material"

type StatisticsDialogProps = {
  readonly onCancel: () => void
  readonly rows: readonly MaterialTagStatistic[]
}

export const MaterialStatisticsDialog = ({ onCancel, rows }: StatisticsDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel}>关闭</Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="标签素材统计"
    width={500}
  >
    <Table
      bordered
      columns={[
        { align: "center", dataIndex: "tag", key: "tag", title: "标签" },
        { align: "center", dataIndex: "count", key: "count", title: "数量", width: 120 },
      ]}
      dataSource={[...rows]}
      pagination={false}
      rowKey="tag"
      scroll={{ x: "max-content" }}
      size="small"
    />
  </Modal>
)

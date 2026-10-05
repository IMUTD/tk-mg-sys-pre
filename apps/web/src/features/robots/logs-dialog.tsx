import { Button, Modal } from "antd"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import type { Robot } from "./robot"

type LogsDialogProps = {
  readonly onCancel: () => void
  readonly robot: Robot
}

export const LogsDialog = ({ onCancel, robot }: LogsDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Link className="robot-log-link" to="/operations/tasks">
          查看任务列表
        </Link>
        <Button onClick={onCancel} type="primary">
          关闭
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title={`运行日志 · ${robot.name}`}
    width={720}
  >
    <pre className="robot-log-pre">
      {robot.logs.length === 0 ? "暂无运行日志" : robot.logs.join("\n")}
    </pre>
  </Modal>
)

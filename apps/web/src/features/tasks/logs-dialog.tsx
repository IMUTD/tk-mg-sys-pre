import { Button, Modal } from "antd"
import type { ReactNode } from "react"

import { type MytTask, taskLogLines } from "./myt-task"

type TaskLogDialogProps = {
  readonly onCancel: () => void
  readonly task: MytTask
}

export const TaskLogDialog = ({ onCancel, task }: TaskLogDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="primary">
          关闭
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title={`任务日志[${task.id}]`}
    width={720}
  >
    <pre className="task-log-pre">{taskLogLines(task).join("\n")}</pre>
  </Modal>
)

import { Alert, App, Button, Collapse, Form, Input, Modal, Select, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  applyFieldTypeChange,
  confidenceTagColor,
  type FieldMapping,
  type FieldType,
  getAvailableFieldOptions,
  getColumnExample,
  getFieldLabel,
  importedResourcesFromParse,
  nowText,
  parseSmartData,
  SMART_IMPORT_PLACEHOLDER,
  type TkRegResource,
} from "./tk-reg-resource"

type SmartImportDialogProps = {
  readonly nextId: number
  readonly onCancel: () => void
  readonly onImported: (resources: readonly TkRegResource[]) => void
}

export const SmartImportDialog = ({
  nextId,
  onCancel,
  onImported,
}: SmartImportDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [rawData, setRawData] = useState("")
  const [rows, setRows] = useState<string[][]>([])
  const [tag, setTag] = useState("")

  const parsed = rows.length > 0
  const canParse = rawData.includes("----")
  const previewRows = useMemo(
    () =>
      rows.slice(0, 5).map((row, index) => ({
        key: index,
        values: row,
      })),
    [rows],
  )

  const parseData = (): void => {
    const result = parseSmartData(rawData)
    setRows(result.rows)
    setMappings(result.mappings)
  }

  const showConfirm = (): void => {
    if (mappings.every((mapping) => mapping.type === "ignore")) {
      message.error("请至少选择一个有效的字段类型")
      return
    }
    setTag("")
    setConfirmOpen(true)
  }

  const executeImport = (): void => {
    const nextTag = tag.trim()
    if (nextTag.length === 0) {
      message.error("请输入分组名称")
      return
    }
    if (nextTag.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    setImporting(true)
    onImported(importedResourcesFromParse(rows, mappings, nextTag, nextId, nowText()))
    setImporting(false)
  }

  return (
    <>
      <Modal
        className="dialog-smart-import"
        footer={
          <div className="dialog-footer">
            <Button onClick={onCancel}>取消</Button>
            <Button disabled={!canParse} onClick={parseData} type="primary">
              解析数据
            </Button>
            {parsed ? (
              <Button onClick={showConfirm} type="primary">
                执行导入
              </Button>
            ) : null}
          </div>
        }
        onCancel={onCancel}
        open
        title="智能导入 [使用前请先联系客服获取使用说明]"
        width="90%"
      >
        <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
          <Form.Item label="原始数据">
            <Input.TextArea
              aria-label="原始数据"
              className="smart-import-editor"
              onChange={(event) => {
                setRawData(event.target.value)
                setRows([])
                setMappings([])
              }}
              placeholder={SMART_IMPORT_PLACEHOLDER}
              rows={10}
              value={rawData}
            />
          </Form.Item>
        </Form>
        {parsed ? (
          <div className="smart-import-result">
            <Alert
              showIcon
              title={`检测到 ${rows.length} 行数据，每行 ${rows[0]?.length ?? 0} 个字段`}
              type="success"
            />
            <Table
              bordered
              columns={[
                {
                  align: "center",
                  key: "index",
                  render: (_value: unknown, _row: FieldMapping, index: number) =>
                    `第${index + 1}列`,
                  title: "列序号",
                  width: 80,
                },
                {
                  key: "type",
                  render: (_value: unknown, mapping: FieldMapping, index: number) => (
                    <Select
                      aria-label={`第${index + 1}列字段类型`}
                      onChange={(value: FieldType) =>
                        setMappings((current) => applyFieldTypeChange(current, index, value))
                      }
                      options={[...getAvailableFieldOptions(mappings, index)]}
                      placeholder="请选择"
                      value={mapping.type}
                      virtual={false}
                    />
                  ),
                  title: "字段类型",
                  width: 150,
                },
                {
                  key: "example",
                  render: (_value: unknown, _mapping: FieldMapping, index: number) => (
                    <span className="muted">{getColumnExample(rows, index)}</span>
                  ),
                  title: "示例数据",
                },
                {
                  key: "detected",
                  render: (_value: unknown, mapping: FieldMapping) => (
                    <Tag color={confidenceTagColor(mapping.confidence)}>
                      {getFieldLabel(mapping.detectedType)}
                    </Tag>
                  ),
                  title: "智能识别",
                  width: 120,
                },
              ]}
              dataSource={mappings}
              pagination={false}
              rowKey={(_mapping, index) => `mapping-${index}`}
              scroll={{ x: "max-content" }}
              size="small"
            />
            <Collapse
              items={[
                {
                  children: (
                    <Table
                      bordered
                      columns={mappings.map((mapping, index) => ({
                        key: `col-${index}`,
                        render: (_value: unknown, row: { values: readonly string[] }) =>
                          row.values[index] ?? "",
                        title: getFieldLabel(mapping.type) || `列${index + 1}`,
                      }))}
                      dataSource={previewRows}
                      pagination={false}
                      rowKey="key"
                      scroll={{ x: "max-content" }}
                      size="small"
                    />
                  ),
                  key: "preview",
                  label: "预览解析结果（前5行）",
                },
              ]}
            />
          </div>
        ) : null}
      </Modal>
      <Modal
        footer={
          <div className="dialog-footer">
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button
              disabled={tag.trim().length === 0}
              loading={importing}
              onClick={executeImport}
              type="primary"
            >
              确认导入
            </Button>
          </div>
        }
        onCancel={() => setConfirmOpen(false)}
        open={confirmOpen}
        title="确认导入"
        width={400}
      >
        <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
          <Form.Item label="分组名称" required>
            <Input
              aria-label="分组名称"
              onChange={(event) => setTag(event.target.value)}
              onPressEnter={executeImport}
              placeholder="请输入分组名称"
              value={tag}
            />
          </Form.Item>
          <Form.Item>
            <span className="muted">
              即将导入 <strong>{rows.length}</strong> 条数据到分组："
              <strong>{tag.trim().length === 0 ? "未填写" : tag.trim()}</strong>"
            </span>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

import { App, Button, Form, Modal, Radio, Select } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { createDispatchApi, type DispatchOptions } from "./dispatch-api"

type DispatchFormProps = {
  readonly groupId: string
  readonly onCancel: () => void
  readonly onCreated: () => void
}

type FileSource = "pool.backup" | "pool.image" | "pool.video"

type FilePick = {
  readonly deviceId?: string
  readonly directory: string
  readonly mode: "random" | "sequence"
}

const emptyOptions = (): DispatchOptions => ({
  accountGroups: [],
  accountTags: [],
  boxGroups: [],
  boxRemarks: [],
  chains: [],
  devices: [],
  pits: [1, 2, 3, 4, 5],
  pools: [],
  proxyGroups: [],
  proxyRemarks: [],
  proxyTags: [],
  textTags: [],
})

const boxLabel = (box: DispatchOptions["devices"][number]): string =>
  box.name.length > 0 && box.name !== box.host ? `${box.name} ${box.host}` : box.host

const fileLabel = (source: FileSource): string => {
  if (source === "pool.image") return "图片目录"
  if (source === "pool.backup") return "备份目录"
  return "视频目录"
}

const rootDirectory = "__root__"

export const DispatchForm = ({ groupId, onCancel, onCreated }: DispatchFormProps): ReactNode => {
  const { message } = App.useApp()
  const [options, setOptions] = useState<DispatchOptions>(emptyOptions)
  const [chainId, setChainId] = useState<string | null>(null)
  const [accountBy, setAccountBy] = useState<"group" | "tag">("group")
  const [accountName, setAccountName] = useState<string | null>(null)
  const [boxBy, setBoxBy] = useState<"group" | "remark">("group")
  const [boxName, setBoxName] = useState<string | null>(null)
  const [proxyBy, setProxyBy] = useState<"group" | "remark">("group")
  const [proxyName, setProxyName] = useState<string | null>(null)
  const [pitIndexes, setPitIndexes] = useState<number[]>([])
  const [files, setFiles] = useState<Record<string, FilePick>>({})
  const [texts, setTexts] = useState<Record<number, { mode: "random" | "sequence" | "tag"; tag?: string }>>({})
  const [saving, setSaving] = useState(false)
  const chain = options.chains.find((item) => item.id === chainId)
  const textSteps = (chain?.steps ?? [])
    .map((step, sequence) => ({ sequence, step }))
    .filter((item) => item.step.api === "SendText")
  const fileSteps = (chain?.steps ?? []).flatMap((step, sequence) => {
    const sources = Object.entries(step.sources).flatMap(([key, source]) =>
      step.scopes[key] === "external" && (source === "pool.video" || source === "pool.image" || source === "pool.backup")
        ? [source]
        : [],
    )
    return [...new Set(sources)].map((source) => ({ sequence, source }))
  })

  useEffect(() => {
    void createDispatchApi(groupId)
      .options()
      .then(setOptions)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }, [groupId, message])

  const submit = (): void => {
    if (chainId === null) {
      message.error("请选择任务")
      return
    }
    if (accountName === null) {
      message.error(accountBy === "group" ? "请选择账号分组" : "请选择账号标签")
      return
    }
    if (textSteps.some((item) => texts[item.sequence]?.mode === "tag" && (texts[item.sequence]?.tag ?? "").length === 0)) {
      message.error("请选择文本池分组")
      return
    }
    if (fileSteps.some((item) => (files[`${item.sequence}:${item.source}`]?.deviceId ?? "").length === 0)) {
      message.error("请选择文件所在盒子")
      return
    }
    setSaving(true)
    void createDispatchApi(groupId)
      .create({
        accounts: { by: accountBy, name: accountName },
        chainId,
        files: fileSteps.map((item) => {
          const picked = files[`${item.sequence}:${item.source}`]
          return {
            deviceId: picked?.deviceId ?? "",
            directory: picked?.directory === rootDirectory ? "" : (picked?.directory ?? ""),
            mode: picked?.mode ?? "sequence",
            sequence: item.sequence,
            source: item.source,
          }
        }),
        pitIndexes,
        texts: textSteps.map((item) => ({
          mode: texts[item.sequence]?.mode ?? "sequence",
          sequence: item.sequence,
          ...(texts[item.sequence]?.tag === undefined ? {} : { tag: texts[item.sequence]?.tag }),
        })),
        ...(boxName === null ? {} : { boxes: { by: boxBy, name: boxName } }),
        ...(proxyName === null ? {} : { proxies: { by: proxyBy, name: proxyName } }),
      })
      .then(() => {
        message.success("新增成功，任务等待开始")
        onCreated()
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
      .finally(() => setSaving(false))
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button loading={saving} onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增任务"
      width={720}
    >
      <Form labelCol={{ style: { width: 110 } }} layout="horizontal" size="small">
        <Form.Item label="选择任务" required>
          <Select
            aria-label="选择任务"
            onChange={(value: string) => setChainId(value)}
            options={options.chains.map((item) => ({ label: item.name, value: item.id }))}
            placeholder="请选择行为链"
            value={chainId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择账号" required>
          <Radio.Group onChange={(event) => { setAccountBy(event.target.value); setAccountName(null) }} value={accountBy}>
            <Radio value="group">分组</Radio>
            <Radio value="tag">标签</Radio>
          </Radio.Group>
          <Select
            allowClear
            aria-label="账号范围"
            onChange={(value: string | null) => setAccountName(value)}
            options={(accountBy === "group" ? options.accountGroups : options.accountTags).map((item) => ({
              label: item,
              value: item,
            }))}
            placeholder={accountBy === "group" ? "选择账号分组" : "选择账号标签"}
            style={{ marginTop: 8, width: "100%" }}
            value={accountName}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择盒子">
          <Radio.Group onChange={(event) => { setBoxBy(event.target.value); setBoxName(null) }} value={boxBy}>
            <Radio value="group">分组</Radio>
            <Radio value="remark">备注</Radio>
          </Radio.Group>
          <Select
            allowClear
            aria-label="盒子范围"
            onChange={(value: string | null) => setBoxName(value)}
            options={(boxBy === "group" ? options.boxGroups : options.boxRemarks).map((item) => ({ label: item, value: item }))}
            placeholder="不选则用账号上一次的盒子"
            style={{ marginTop: 8, width: "100%" }}
            value={boxName}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择坑位">
          <Select
            allowClear
            aria-label="选择坑位"
            mode="multiple"
            onChange={(value: number[]) => setPitIndexes(value)}
            options={options.pits.map((item) => ({ label: String(item), value: item }))}
            placeholder="不选则用账号上一次的坑位"
            value={pitIndexes}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="选择代理">
          <Radio.Group onChange={(event) => { setProxyBy(event.target.value); setProxyName(null) }} value={proxyBy}>
            <Radio value="group">分组</Radio>
            <Radio value="remark">备注</Radio>
          </Radio.Group>
          <Select
            allowClear
            aria-label="代理范围"
            onChange={(value: string | null) => setProxyName(value)}
            options={(proxyBy === "group" ? options.proxyGroups : options.proxyRemarks).map((item) => ({
              label: item,
              value: item,
            }))}
            placeholder="不选则用账号上一次的代理"
            style={{ marginTop: 8, width: "100%" }}
            value={proxyName}
            virtual={false}
          />
        </Form.Item>
        {fileSteps.map((item) => (
          <FileDirectoryField
            groupId={groupId}
            key={`${item.sequence}:${item.source}`}
            onChange={(pick) => setFiles((current) => ({ ...current, [`${item.sequence}:${item.source}`]: pick }))}
            options={options}
            picked={files[`${item.sequence}:${item.source}`] ?? { directory: rootDirectory, mode: "sequence" }}
            sequence={item.sequence}
            source={item.source}
          />
        ))}
        {textSteps.map((item) => (
          <Form.Item key={item.sequence} label={`第 ${item.sequence + 1} 步输入文字`}>
            <Radio.Group
              onChange={(event) =>
                setTexts((current) => ({
                  ...current,
                  [item.sequence]: { ...current[item.sequence], mode: event.target.value },
                }))
              }
              value={texts[item.sequence]?.mode ?? "sequence"}
            >
              <Radio value="random">随机</Radio>
              <Radio value="sequence">顺序</Radio>
              <Radio value="tag">指定分组</Radio>
            </Radio.Group>
            {(texts[item.sequence]?.mode ?? "sequence") === "tag" ? (
              <Select
                aria-label={`第 ${item.sequence + 1} 步文本分组`}
                onChange={(value: string) =>
                  setTexts((current) => ({
                    ...current,
                    [item.sequence]: { mode: "tag", tag: value },
                  }))
                }
                options={options.textTags.map((tag) => ({ label: tag, value: tag }))}
                placeholder="选择文本池分组"
                style={{ marginTop: 8, width: "100%" }}
                value={texts[item.sequence]?.tag}
                virtual={false}
              />
            ) : null}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}

const FileDirectoryField = ({
  groupId,
  onChange,
  options,
  picked,
  sequence,
  source,
}: {
  readonly groupId: string
  readonly onChange: (pick: FilePick) => void
  readonly options: DispatchOptions
  readonly picked: FilePick
  readonly sequence: number
  readonly source: FileSource
}): ReactNode => {
  const [directories, setDirectories] = useState<readonly { readonly count: number; readonly directory: string }[]>([])
  useEffect(() => {
    if (picked.deviceId === undefined) {
      setDirectories([])
      return
    }
    const deviceId = picked.deviceId
    void createDispatchApi(groupId)
      .directories(deviceId, source)
      .then(setDirectories)
      .catch(() => setDirectories([]))
  }, [groupId, picked.deviceId, source])
  return (
    <Form.Item label={`第 ${sequence + 1} 步${fileLabel(source)}`}>
      <Select
        aria-label={`第 ${sequence + 1} 步文件盒子`}
        onChange={(value: string) => onChange({ ...picked, deviceId: value, directory: rootDirectory })}
        options={options.devices.map((item) => ({ label: boxLabel(item), value: item.id }))}
        placeholder="选择文件所在盒子"
        value={picked.deviceId}
        virtual={false}
      />
      <Select
        aria-label={`第 ${sequence + 1} 步文件目录`}
        onChange={(value: string) => onChange({ ...picked, directory: value })}
        options={[
          {
            label:
              directories.find((item) => item.directory.length === 0) === undefined
                ? "根目录"
                : `根目录（${directories.find((item) => item.directory.length === 0)?.count ?? 0}）`,
            value: rootDirectory,
          },
          ...directories
            .filter((item) => item.directory.length > 0)
            .map((item) => ({ label: `${item.directory}（${item.count}）`, value: item.directory })),
        ]}
        style={{ marginTop: 8, width: "100%" }}
        value={picked.directory}
        virtual={false}
      />
      <Radio.Group onChange={(event) => onChange({ ...picked, mode: event.target.value })} value={picked.mode}>
        <Radio value="sequence">顺序</Radio>
        <Radio value="random">随机</Radio>
      </Radio.Group>
    </Form.Item>
  )
}

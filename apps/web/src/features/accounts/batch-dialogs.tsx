import { Alert, Button, Checkbox, Form, Input, Modal, Radio, Select } from "antd"
import { type ReactNode, useMemo } from "react"

import {
  type AccountBackType,
  type AccountDevice,
  type AccountProxy,
  type AssignProxyMode,
  BACK_TYPE_OPTIONS,
  BACKUP_APP_OPTIONS,
  formatProxyOptionLabel,
  SEQ_LIST,
} from "./myt-account"

type SelectDialogProps = {
  readonly extra?: ReactNode
  readonly label: string
  readonly onCancel: () => void
  readonly onOk: () => void
  readonly options: readonly { label: string; value: string }[]
  readonly placeholder: string
  readonly title: string
  readonly value: string
  onChange(value: string): void
}

const SelectDialog = ({
  extra,
  label,
  onCancel,
  onChange,
  onOk,
  options,
  placeholder,
  title,
  value,
}: SelectDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button disabled={value.trim().length === 0} onClick={onOk} type="primary">
          确认
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title={title}
    width={480}
  >
    {extra}
    <Form layout="vertical" size="small">
      <Form.Item label={label} required>
        <Select
          aria-label={label}
          onChange={onChange}
          options={[...options]}
          placeholder={placeholder}
          showSearch
          value={value.length === 0 ? null : value}
          virtual={false}
        />
      </Form.Item>
    </Form>
  </Modal>
)

type MoveTagDialogProps = {
  readonly newTag: string
  readonly oldTags: readonly string[]
  readonly onCancel: () => void
  readonly onChange: (oldTags: readonly string[], newTag: string) => void
  readonly onOk: () => void
  readonly tags: readonly string[]
}

export const MoveTagDialog = ({
  newTag,
  oldTags,
  onCancel,
  onChange,
  onOk,
  tags,
}: MoveTagDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button
          disabled={oldTags.length === 0 || newTag.trim().length === 0}
          onClick={onOk}
          type="primary"
        >
          确认移动分组
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="账号分组调整"
    width={520}
  >
    <Alert message="将旧的分组账号合并到新的分组" showIcon type="info" />
    <Form className="batch-form" layout="vertical" size="small">
      <Form.Item label="旧的分组" required>
        <Select
          aria-label="旧的分组"
          mode="multiple"
          onChange={(value: string[]) => onChange(value, newTag)}
          options={tags.map((tag) => ({ label: tag, value: tag }))}
          placeholder="请选择待移动的分组"
          value={[...oldTags]}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="新的分组" required>
        <Select
          aria-label="新的分组"
          onChange={(value: string) => onChange(oldTags, value)}
          options={tags.map((tag) => ({ label: tag, value: tag }))}
          placeholder="请选择,新建分组请输入后点击"
          showSearch
          value={newTag.length === 0 ? null : newTag}
          virtual={false}
        />
      </Form.Item>
    </Form>
  </Modal>
)

type AssignProxyDialogProps = {
  readonly accountCount: number
  readonly accountTags: readonly string[]
  readonly assignMode: AssignProxyMode
  readonly nums: number
  readonly onCancel: () => void
  readonly onChange: (next: {
    accountTags: readonly string[]
    assignMode: AssignProxyMode
    proxyId: number | null
    proxyTags: readonly string[]
  }) => void
  readonly onOk: () => void
  readonly proxyCount: number
  readonly proxyId: number | null
  readonly proxyTags: readonly string[]
  readonly proxies: readonly AccountProxy[]
  readonly tags: readonly string[]
  readonly usedCounts: ReadonlyMap<number, number>
}

export const AssignProxyDialog = ({
  accountCount,
  accountTags,
  assignMode,
  nums,
  onCancel,
  onChange,
  onOk,
  proxyCount,
  proxyId,
  proxyTags,
  proxies,
  tags,
  usedCounts,
}: AssignProxyDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button onClick={onOk} type="primary">
          确认分配代理
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="代理分配"
    width={560}
  >
    <Alert message="将所选代理分组或目标代理分配给所选账号分组" showIcon type="info" />
    <Form className="batch-form" layout="vertical" size="small">
      <Form.Item label="账号分组" required>
        <Select
          aria-label="分配账号分组"
          mode="multiple"
          onChange={(value: string[]) =>
            onChange({ accountTags: value, assignMode, proxyId, proxyTags })
          }
          options={tags.map((tag) => ({ label: tag, value: tag }))}
          placeholder="请选择账号分组"
          value={[...accountTags]}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="代理分组">
        <Select
          aria-label="代理分组"
          mode="multiple"
          onChange={(value: string[]) =>
            onChange({ accountTags, assignMode, proxyId, proxyTags: value })
          }
          options={[...new Set(proxies.map((proxy) => proxy.remark))].map((tag) => ({
            label: tag,
            value: tag,
          }))}
          placeholder="请选择代理分组"
          value={[...proxyTags]}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="目标代理">
        <Select
          allowClear
          aria-label="目标代理"
          onChange={(value: number | null) =>
            onChange({ accountTags, assignMode, proxyId: value ?? null, proxyTags })
          }
          options={proxies.map((proxy) => ({
            label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
            value: proxy.id,
          }))}
          placeholder="可选，选择后优先使用该代理"
          value={proxyId}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="分配方式">
        <Radio.Group
          onChange={(event) =>
            onChange({
              accountTags,
              assignMode: event.target.value as AssignProxyMode,
              proxyId,
              proxyTags,
            })
          }
          value={assignMode}
        >
          <Radio value="average">平均分配</Radio>
          <Radio value="random">随机分配</Radio>
        </Radio.Group>
      </Form.Item>
      <Form.Item label="预估数量">
        <span>
          账号 {accountCount} / 代理 {proxyCount} ，约 {nums} 个账号/代理
        </span>
      </Form.Item>
    </Form>
  </Modal>
)

type TagBucketDialogProps = {
  readonly mode: "add" | "remove"
  readonly onCancel: () => void
  readonly onChange: (tags: string[]) => void
  readonly onOk: () => void
  readonly options: readonly string[]
  readonly tags: readonly string[]
}

export const TagBucketDialog = ({
  mode,
  onCancel,
  onChange,
  onOk,
  options,
  tags,
}: TagBucketDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button disabled={tags.length === 0} onClick={onOk} type="primary">
          保存标签
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="输入标签名"
    width={600}
  >
    <Select
      aria-label="输入标签名"
      mode="tags"
      onChange={onChange}
      options={options.map((tag) => ({ label: tag, value: tag }))}
      placeholder="请输入标签"
      style={{ width: "100%" }}
      value={[...tags]}
      virtual={false}
    />
    <div className="muted" style={{ marginTop: 8 }}>
      {mode === "add" ? "为选中或当前筛选账号添加标签" : "从选中或当前筛选账号移除标签"}
    </div>
  </Modal>
)

export const EditTagDialog = ({
  onCancel,
  onChange,
  onOk,
  tags,
  value,
}: {
  readonly onCancel: () => void
  readonly onChange: (value: string) => void
  readonly onOk: () => void
  readonly tags: readonly string[]
  readonly value: string
}): ReactNode => (
  <SelectDialog
    extra={<Alert message="将已选账号移动到新的分组" showIcon type="info" />}
    label="新的分组"
    onCancel={onCancel}
    onChange={onChange}
    onOk={onOk}
    options={tags.map((tag) => ({ label: tag, value: tag }))}
    placeholder="请选择,新建分组请输入后点击"
    title="批量修改分组"
    value={value}
  />
)

export const EditProxyDialog = ({
  onCancel,
  onChange,
  onOk,
  proxies,
  usedCounts,
  value,
}: {
  readonly onCancel: () => void
  readonly onChange: (value: number | null) => void
  readonly onOk: () => void
  readonly proxies: readonly AccountProxy[]
  readonly usedCounts: ReadonlyMap<number, number>
  readonly value: number | null
}): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button disabled={value === null} onClick={onOk} type="primary">
          确认修改代理
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="批量修改代理"
    width={520}
  >
    <Alert message="将已选账号批量绑定新的代理" showIcon type="info" />
    <Form layout="vertical" size="small">
      <Form.Item label="代理" required>
        <Select
          aria-label="批量代理"
          onChange={(next: number) => onChange(next)}
          options={proxies.map((proxy) => ({
            label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
            value: proxy.id,
          }))}
          placeholder="请选择"
          value={value}
          virtual={false}
        />
      </Form.Item>
    </Form>
  </Modal>
)

export const EditRegionDialog = ({
  onCancel,
  onChange,
  onOk,
  value,
}: {
  readonly onCancel: () => void
  readonly onChange: (value: string) => void
  readonly onOk: () => void
  readonly value: string
}): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button onClick={onOk} type="primary">
          确认修改归属地
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="批量修改归属地"
    width={480}
  >
    <Alert
      message="本功能仅用于数据更正，仅修改我方系统中记录的归属地，无法修改真实归属地"
      showIcon
      type="warning"
    />
    <Form layout="vertical" size="small">
      <Form.Item label="国家简称" required>
        <Input
          aria-label="国家简称"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="请输入国家简称，如 US、GB、DE"
          value={value}
        />
      </Form.Item>
    </Form>
  </Modal>
)

type BackupDialogProps = {
  readonly app: string
  readonly backType: AccountBackType
  readonly closeAfter: boolean
  readonly deviceId: number | null
  readonly deviceSeq: number | null
  readonly devices: readonly AccountDevice[]
  readonly onCancel: () => void
  readonly onChange: (next: {
    app: string
    backType: AccountBackType
    closeAfter: boolean
    deviceId: number | null
    deviceSeq: number | null
    openLog: boolean
    password: string
    proxyId: number | null
    tag: string
    username: string
  }) => void
  readonly onOk: () => void
  readonly openLog: boolean
  readonly password: string
  readonly proxies: readonly AccountProxy[]
  readonly proxyId: number | null
  readonly tag: string
  readonly tags: readonly string[]
  readonly usedCounts: ReadonlyMap<number, number>
  readonly username: string
}

export const BackupDialog = ({
  app,
  backType,
  closeAfter,
  deviceId,
  deviceSeq,
  devices,
  onCancel,
  onChange,
  onOk,
  openLog,
  password,
  proxies,
  proxyId,
  tag,
  tags,
  usedCounts,
  username,
}: BackupDialogProps): ReactNode => {
  const patch = (partial: Partial<Parameters<BackupDialogProps["onChange"]>[0]>): void =>
    onChange({
      app,
      backType,
      closeAfter,
      deviceId,
      deviceSeq,
      openLog,
      password,
      proxyId,
      tag,
      username,
      ...partial,
    })
  const selected = useMemo(
    () => devices.find((device) => device.id === deviceId) ?? null,
    [deviceId, devices],
  )

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button onClick={onOk} type="primary">
            立即备份
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="备份账号"
      width={600}
    >
      <Alert
        message="将容器中手动注册的账号备份到账号列表,仅适用于本系统创建的容器"
        showIcon
        type="warning"
      />
      <Form
        className="batch-form"
        labelCol={{ style: { width: 80 } }}
        layout="horizontal"
        size="small"
      >
        <Form.Item label="设备" required>
          <Select
            aria-label="备份设备"
            onChange={(value: number) => patch({ deviceId: value })}
            options={devices.map((device) => ({
              label: `${device.name} - ${device.ip}`,
              value: device.id,
            }))}
            placeholder="请选择"
            value={deviceId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="机位" required>
          <Radio.Group
            onChange={(event) => patch({ deviceSeq: Number(event.target.value) })}
            value={deviceSeq}
          >
            {SEQ_LIST.map((seq) => (
              <Radio.Button key={seq} value={seq}>
                {seq}
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>
        <Form.Item label="代理">
          <Select
            allowClear
            aria-label="备份代理"
            onChange={(value: number | null) => patch({ proxyId: value ?? null })}
            options={proxies.map((proxy) => ({
              label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
              value: proxy.id,
            }))}
            placeholder="请选择"
            value={proxyId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="备份方式">
          <Select
            aria-label="备份方式"
            onChange={(value: AccountBackType) => patch({ backType: value })}
            options={[...BACK_TYPE_OPTIONS]}
            value={backType}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="APP">
          <Radio.Group onChange={(event) => patch({ app: event.target.value })} value={app}>
            {BACKUP_APP_OPTIONS.map((option) => (
              <Radio.Button key={option.value} value={option.value}>
                {option.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>
        <Form.Item label="账号分组">
          <Select
            aria-label="备份账号分组"
            onChange={(value: string) => patch({ tag: value })}
            options={tags.map((item) => ({ label: item, value: item }))}
            placeholder="请选择"
            showSearch
            value={tag.length === 0 ? null : tag}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="账号">
          <Input
            aria-label="备份账号"
            onChange={(event) => patch({ username: event.target.value })}
            value={username}
          />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password
            aria-label="备份密码"
            autoComplete="new-password"
            onChange={(event) => patch({ password: event.target.value })}
            value={password}
          />
        </Form.Item>
        <Form.Item label="选项">
          <Checkbox
            checked={openLog}
            onChange={(event) => patch({ openLog: event.target.checked })}
          >
            启动后打开日志窗口
          </Checkbox>
          <Checkbox
            checked={closeAfter}
            onChange={(event) => patch({ closeAfter: event.target.checked })}
          >
            启动后关闭此窗口
          </Checkbox>
        </Form.Item>
        {selected === null ? null : (
          <div className="muted">
            {selected.name} / {selected.ip}
          </div>
        )}
      </Form>
    </Modal>
  )
}

type RestoreDialogProps = {
  readonly closeAfter: boolean
  readonly deviceId: number | null
  readonly deviceSeq: number | null
  readonly devices: readonly AccountDevice[]
  readonly onCancel: () => void
  readonly onChange: (next: {
    closeAfter: boolean
    deviceId: number | null
    deviceSeq: number | null
    openLog: boolean
    proxyId: number | null
  }) => void
  readonly onOk: () => void
  readonly openLog: boolean
  readonly proxies: readonly AccountProxy[]
  readonly proxyId: number | null
  readonly title: string
  readonly usedCounts: ReadonlyMap<number, number>
}

export const RestoreDialog = ({
  closeAfter,
  deviceId,
  deviceSeq,
  devices,
  onCancel,
  onChange,
  onOk,
  openLog,
  proxies,
  proxyId,
  title,
  usedCounts,
}: RestoreDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel} type="text">
          取消
        </Button>
        <Button onClick={onOk} type="primary">
          立即启动
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title={title}
    width={600}
  >
    <Alert
      message="将选中的账号在指定窗口中运行,大概需要20秒钟启动账号,请打开对应的窗口查看"
      showIcon
      type="warning"
    />
    <Form
      className="batch-form"
      labelCol={{ style: { width: 80 } }}
      layout="horizontal"
      size="small"
    >
      <Form.Item label="设备" required>
        <Select
          aria-label="启动设备"
          onChange={(value: number) =>
            onChange({ closeAfter, deviceId: value, deviceSeq, openLog, proxyId })
          }
          options={devices.map((device) => ({
            label: `${device.name} - ${device.ip}`,
            value: device.id,
          }))}
          placeholder="请选择"
          value={deviceId}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="机位" required>
        <Radio.Group
          onChange={(event) =>
            onChange({
              closeAfter,
              deviceId,
              deviceSeq: Number(event.target.value),
              openLog,
              proxyId,
            })
          }
          value={deviceSeq}
        >
          {SEQ_LIST.map((seq) => (
            <Radio.Button key={seq} value={seq}>
              {seq}
            </Radio.Button>
          ))}
        </Radio.Group>
      </Form.Item>
      <Form.Item label="代理">
        <Select
          allowClear
          aria-label="启动代理"
          onChange={(value: number | null) =>
            onChange({ closeAfter, deviceId, deviceSeq, openLog, proxyId: value ?? null })
          }
          options={proxies.map((proxy) => ({
            label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
            value: proxy.id,
          }))}
          placeholder="请选择"
          value={proxyId}
          virtual={false}
        />
      </Form.Item>
      <Form.Item label="选项">
        <Checkbox
          checked={openLog}
          onChange={(event) =>
            onChange({ closeAfter, deviceId, deviceSeq, openLog: event.target.checked, proxyId })
          }
        >
          启动后打开日志窗口
        </Checkbox>
        <Checkbox
          checked={closeAfter}
          onChange={(event) =>
            onChange({ closeAfter: event.target.checked, deviceId, deviceSeq, openLog, proxyId })
          }
        >
          启动后关闭此窗口
        </Checkbox>
      </Form.Item>
    </Form>
  </Modal>
)

type CheckTaskDialogProps = {
  readonly accountInfoCount: number
  readonly autoStart: boolean
  readonly onCancel: () => void
  readonly onChange: (next: { autoStart: boolean; updateVideoData: boolean }) => void
  readonly onOk: () => void
  readonly tagLabel: string
  readonly totalCount: number
  readonly updateVideoData: boolean
}

export const CheckTaskDialog = ({
  accountInfoCount,
  autoStart,
  onCancel,
  onChange,
  onOk,
  tagLabel,
  totalCount,
  updateVideoData,
}: CheckTaskDialogProps): ReactNode => (
  <Modal
    footer={
      <div className="dialog-footer">
        <Button onClick={onCancel}>取消</Button>
        <Button onClick={onOk} type="primary">
          确认加入
        </Button>
      </div>
    }
    onCancel={onCancel}
    open
    title="加入后台任务"
    width={500}
  >
    <Alert message={`当前分组：${tagLabel}`} showIcon type="info" />
    <div className="check-task-rows">
      <div className="filter-row">
        <span className="filter-label">默认状态：</span>
        <span>正常</span>
      </div>
      <div className="filter-row">
        <span className="filter-label">预计命中：</span>
        <span>{totalCount} 个账号</span>
      </div>
      <div className="filter-row">
        <span className="filter-label">扣除次数：</span>
        <span>{totalCount}</span>
      </div>
      <div className="filter-row">
        <span className="filter-label">今日剩余：</span>
        <span>{accountInfoCount}</span>
      </div>
      <div className="filter-row">
        <span className="filter-label">更新视频数据：</span>
        <Checkbox
          checked={updateVideoData}
          onChange={(event) => onChange({ autoStart, updateVideoData: event.target.checked })}
        />
      </div>
      <div className="filter-row">
        <span className="filter-label">自动启动：</span>
        <Checkbox
          checked={autoStart}
          onChange={(event) => onChange({ autoStart: event.target.checked, updateVideoData })}
        />
      </div>
    </div>
    <div className="danger-text">
      统计结果仅供参考，可能受平台延迟、网络波动及账号状态变化影响，请以平台实际数据为准。
    </div>
  </Modal>
)

type PlayStatsDialogProps = {
  readonly accounts: readonly {
    follower: number
    playBeforeYesterday: number
    playToday: number
    playTotal: number
    playYesterday: number
    status: string
    tag: string
    uid: string
    username: string
  }[]
  readonly remaining: number
  readonly onCancel: () => void
}

export const PlayStatsDialog = ({
  accounts,
  onCancel,
  remaining,
}: PlayStatsDialogProps): ReactNode => {
  const banned = accounts.filter((item) => item.status === "1").length
  const totalPlay = accounts.reduce((sum, item) => sum + item.playTotal, 0)
  const today = accounts.reduce((sum, item) => sum + item.playToday, 0)
  const yesterday = accounts.reduce((sum, item) => sum + item.playYesterday, 0)
  const before = accounts.reduce((sum, item) => sum + item.playBeforeYesterday, 0)
  return (
    <Modal footer={null} onCancel={onCancel} open title="批量查询播放量" width="90%">
      <div className="play-stats-summary">
        总数 {accounts.length}　封号 {banned}　总播放 {totalPlay}　今日剩余次数 {remaining}
        　前天播放 {before}　昨日播放 {yesterday}　今日播放 {today}
      </div>
      <table className="play-stats-table">
        <thead>
          <tr>
            <th>分组</th>
            <th>用户名</th>
            <th>UID</th>
            <th>粉丝</th>
            <th>播放总和</th>
            <th>今日播放</th>
            <th>昨日播放</th>
            <th>前天播放</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((item) => (
            <tr key={item.uid}>
              <td>{item.tag}</td>
              <td>{item.username}</td>
              <td>{item.uid.length === 0 ? "封号" : item.uid}</td>
              <td>{item.follower}</td>
              <td>{item.playTotal}</td>
              <td>{item.playToday}</td>
              <td>{item.playYesterday}</td>
              <td>{item.playBeforeYesterday}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

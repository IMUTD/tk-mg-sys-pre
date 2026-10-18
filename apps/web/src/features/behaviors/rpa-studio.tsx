import { App, Button, Card, Input, Modal, Select, Switch } from "antd"
import { type MutableRefObject, type ReactNode, useEffect, useId, useState } from "react"
import { SaveChainDialog } from "./chain-list"
import { saveChain, useChains } from "./chain-store"
import {
  type AnchorField,
  type AnchorKey,
  apiByCode,
  type BehaviorChain,
  type ChainStep,
  chainFingerprint,
  createStep,
  type GuardCode,
  normalizeDelay,
  paramLabel,
  publishChainSteps,
  type SkillSpec,
  skillCatalog,
  stepText,
} from "./rpa-api"
import { applyScreenToParams, type DevicePoint } from "./screen-map"

type RpaStudioProps = {
  readonly anchorFields: readonly AnchorField[]
  readonly anchorKeys: readonly AnchorKey[]
  readonly applyScreen: MutableRefObject<(start: DevicePoint, end: DevicePoint) => string | null>
  readonly canWrite: boolean
  readonly onTest: (name: string, steps: readonly ChainStep[]) => boolean
  readonly skills: readonly SkillSpec[]
}

export const RpaStudio = ({
  anchorFields,
  anchorKeys,
  applyScreen,
  canWrite,
  onTest,
  skills,
}: RpaStudioProps): ReactNode => {
  const { message, modal } = App.useApp()
  const studioId = useId()
  const chains = useChains()
  const [steps, setSteps] = useState<ChainStep[]>([])
  const [nextId, setNextId] = useState(1)
  const [pick, setPick] = useState("TouchClick")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = skills.length > 0 ? skills : skillCatalog()
  const [testedKey, setTestedKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadingChain, setLoadingChain] = useState(false)
  const [anchorTable, setAnchorTable] = useState("")
  const [anchorKey, setAnchorKey] = useState<AnchorKey["key"]>("id")
  const fingerprint = chainFingerprint(steps)
  const sourcesReady = steps.every((step) =>
    Object.keys(step.params).every(
      (key) => step.scopes[key] !== "external" || (step.sources?.[key] ?? "").length > 0,
    ),
  )
  const canSave = canWrite && steps.length > 0 && testedKey === fingerprint && sourcesReady
  const constrained = anchorTable === "operation_account"

  const addStep = (): void => {
    const id = nextId
    setSteps((current) => [...current, createStep(pick, id)])
    setNextId((current) => current + 1)
    setSelectedId(id)
    setTestedKey("")
  }

  const patchStep = (id: number, key: string, value: string): void => {
    setSteps((current) =>
      current.map((item) =>
        item.id === id ? { ...item, params: { ...item.params, [key]: value } } : item,
      ),
    )
    setTestedKey("")
  }

  const setGuard = (id: number, code: GuardCode, on: boolean): void => {
    setSteps((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        const guards = (item.guards ?? []).filter((itemCode) => itemCode !== code)
        return { ...item, guards: on ? [...guards, code] : guards }
      }),
    )
    setTestedKey("")
  }

  const setDelay = (id: number, raw: string): void => {
    const digits = raw.replace(/\D/g, "")
    const delayMs = normalizeDelay(digits.length === 0 ? 0 : Number(digits))
    setSteps((current) => current.map((item) => (item.id === id ? { ...item, delayMs } : item)))
    setTestedKey("")
  }

  const chooseAnchor = (value: string): void => {
    setAnchorTable(value)
    setTestedKey("")
    if (value === "operation_account") return
    setSteps((current) =>
      current.map((item) => ({
        ...item,
        scopes: Object.fromEntries(Object.keys(item.params).map((key) => [key, "internal"])),
        sources: Object.fromEntries(Object.keys(item.params).map((key) => [key, "literal"])),
      })),
    )
  }

  const setScope = (id: number, key: string, internal: boolean): void => {
    if (!internal && !constrained) return
    setSteps((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        if (item.api === "JumpNodes" && key === "steps" && !internal) return item
        return {
          ...item,
          scopes: { ...item.scopes, [key]: internal ? "internal" : "external" },
          sources: { ...item.sources, [key]: internal ? "literal" : "" },
        }
      }),
    )
  }

  const setSource = (id: number, key: string, source: string): void => {
    setSteps((current) =>
      current.map((item) =>
        item.id === id ? { ...item, sources: { ...item.sources, [key]: source } } : item,
      ),
    )
  }

  const applyChain = (chain: BehaviorChain): void => {
    const loaded = chain.steps.map((step, index) => ({
      api: step.api,
      delayMs: step.delayMs,
      guards: [...step.guards],
      id: index,
      params: { ...step.params },
      scopes: { ...step.scopes },
      sources: { ...step.sources },
    }))
    setSteps(loaded)
    setNextId(loaded.length)
    setSelectedId(loaded[0]?.id ?? null)
    setAnchorTable(chain.anchor?.table ?? "")
    setAnchorKey(chain.anchor?.key ?? "id")
    setTestedKey("")
    setLoadingChain(false)
    message.success(`已载入「${chain.name}」`)
  }

  const requestLoad = (chain: BehaviorChain): void => {
    if (steps.length === 0) {
      applyChain(chain)
      return
    }
    void modal.confirm({
      cancelText: "取消",
      content: `载入「${chain.name}」后，当前编排会被换掉。`,
      okText: "载入",
      onOk: () => applyChain(chain),
      title: "载入行为链",
    })
  }

  const move = (id: number, offset: number): void => {
    setSteps((current) => {
      const index = current.findIndex((item) => item.id === id)
      const target = index + offset
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = current.slice()
      const [removed] = next.splice(index, 1)
      if (removed === undefined) return current
      next.splice(target, 0, removed)
      return next
    })
    setTestedKey("")
  }

  useEffect(() => {
    applyScreen.current = (start, end) => {
      const step = steps.find((item) => item.id === selectedId)
      if (step === undefined) return "先点一条 RPA 步骤再点画面"
      const applied = applyScreenToParams(step.params, start, end)
      if (applied === null) return "当前步骤没有坐标参数"
      setSteps((current) =>
        current.map((item) => (item.id === step.id ? { ...item, params: applied.params } : item)),
      )
      setTestedKey("")
      return applied.message
    }
    return () => {
      applyScreen.current = () => null
    }
  }, [applyScreen, selectedId, steps])

  return (
    <div className="behaviors-pane rpa-studio">
      {canWrite ? (
        <div className="behaviors-toolbar">
          <Select
            aria-label="约束数据表"
            onChange={chooseAnchor}
            options={[
              { label: "不约束", value: "" },
              { label: "账号表", value: "operation_account" },
            ]}
            style={{ width: 140 }}
            value={anchorTable}
            virtual={false}
          />
          {constrained ? (
            <Select
              aria-label="约束条件"
              onChange={(value: AnchorKey["key"]) => {
                setAnchorKey(value)
                setTestedKey("")
              }}
              options={anchorKeys.map((item) => ({ label: item.label, value: item.key }))}
              style={{ width: 140 }}
              value={anchorKey}
              virtual={false}
            />
          ) : null}
          <Select
            aria-label="RPA接口"
            onChange={setPick}
            options={list.map((item) => ({
              label: `${item.group} / ${item.name}`,
              value: item.code,
            }))}
            style={{ width: 260 }}
            value={pick}
            virtual={false}
          />
          <Button onClick={addStep} type="primary">
            添加步骤
          </Button>
          <Button onClick={() => setLoadingChain(true)}>载入</Button>
          <Button
            disabled={steps.length === 0}
            onClick={() => {
              const ok = onTest("RPA草稿", steps)
              if (ok) {
                setTestedKey(fingerprint)
                message.success("全链测试已下发，可以保存为行为链")
              }
            }}
          >
            全链测试
          </Button>
          <Button disabled={!canSave} onClick={() => setSaving(true)}>
            保存为行为链
          </Button>
        </div>
      ) : (
        <p className="behaviors-meta">仅管理员可以编排并保存行为链。</p>
      )}
      {steps.length === 0 ? (
        <Card className="behaviors-empty">从上方选择魔云腾 RPA 接口，按执行顺序编排行为链。</Card>
      ) : (
        <div className="rpa-step-list">
          {steps.map((item, index) => (
            <Card
              className={item.id === selectedId ? "rpa-step rpa-step-on" : "rpa-step"}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              size="small"
              title={`${index + 1}. ${stepText(item)}`}
            >
              <div className="rpa-step-params">
                {Object.keys(item.params).map((key) => {
                  const external = item.scopes[key] === "external"
                  const jumpCount = item.api === "JumpNodes" && key === "steps"
                  return (
                    <div className="rpa-param" key={key}>
                      {external ? (
                        <label className="rpa-source" htmlFor={`${studioId}-${item.id}-${key}`}>
                          <span className="rpa-source-label">
                            {paramLabel(apiByCode(item.api), key)}
                          </span>
                          <Select<string>
                            aria-label={`${item.api}-${key}-来源`}
                            id={`${studioId}-${item.id}-${key}`}
                            onChange={(source) => setSource(item.id, key, source)}
                            options={anchorFields.map((field) => ({
                              label: field.label,
                              value: field.source,
                            }))}
                            placeholder="选择字段"
                            style={{ width: 160 }}
                            value={item.sources?.[key] || null}
                            virtual={false}
                          />
                        </label>
                      ) : (
                        <Input
                          addonBefore={paramLabel(apiByCode(item.api), key)}
                          aria-label={`${item.api}-${key}`}
                          onChange={(event) => patchStep(item.id, key, event.target.value)}
                          value={item.params[key]}
                        />
                      )}
                      <Switch
                        aria-label={`${item.api}-${key}-范围`}
                        checked={!external}
                        checkedChildren="内部"
                        disabled={jumpCount || !constrained}
                        onChange={(internal) => setScope(item.id, key, internal)}
                        size="small"
                        unCheckedChildren="外部"
                      />
                    </div>
                  )
                })}
                <div className="rpa-delay">
                  <Input
                    addonAfter="毫秒"
                    addonBefore="延时"
                    aria-label={`${item.api}-延时`}
                    onChange={(event) => setDelay(item.id, event.target.value)}
                    value={item.delayMs > 0 ? String(item.delayMs) : ""}
                  />
                </div>
                <div className="rpa-guards">
                  <span>守护</span>
                  <label htmlFor={`${studioId}-${item.id}-ad`}>
                    <Switch
                      aria-label={`${item.api}-广告通过`}
                      id={`${studioId}-${item.id}-ad`}
                      checked={(item.guards ?? []).includes("ad")}
                      onChange={(on) => setGuard(item.id, "ad", on)}
                      size="small"
                    />
                    广告通过
                  </label>
                  <label htmlFor={`${studioId}-${item.id}-transcode`}>
                    <Switch
                      aria-label={`${item.api}-转码通过`}
                      id={`${studioId}-${item.id}-transcode`}
                      checked={(item.guards ?? []).includes("transcode")}
                      onChange={(on) => setGuard(item.id, "transcode", on)}
                      size="small"
                    />
                    转码通过
                  </label>
                </div>
              </div>
              {canWrite ? (
                <div className="rpa-step-actions">
                  <Button
                    aria-label={`${item.api}-单步测试`}
                    onClick={() => {
                      setSelectedId(item.id)
                      const ok = onTest(stepText(item), [item])
                      if (ok) message.success("已下发单步测试")
                    }}
                    size="small"
                    type="primary"
                  >
                    测试
                  </Button>
                  <Button disabled={index === 0} onClick={() => move(item.id, -1)} size="small">
                    上移
                  </Button>
                  <Button
                    disabled={index === steps.length - 1}
                    onClick={() => move(item.id, 1)}
                    size="small"
                  >
                    下移
                  </Button>
                  <Button
                    danger
                    onClick={() => {
                      setSteps((current) => current.filter((step) => step.id !== item.id))
                      setTestedKey("")
                    }}
                    size="small"
                  >
                    删除
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {loadingChain ? (
        <Modal
          footer={null}
          onCancel={() => setLoadingChain(false)}
          open
          title="载入行为链"
          width={420}
        >
          {chains.length === 0 ? (
            <p className="behaviors-meta">暂无行为链</p>
          ) : (
            <div className="rpa-load-list">
              {chains.map((chain) => (
                <Button key={chain.id} onClick={() => requestLoad(chain)}>
                  {chain.name} · {chain.steps.length} 步
                </Button>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
      {saving ? (
        <SaveChainDialog
          onCancel={() => setSaving(false)}
          onSubmit={(name) => {
            void saveChain(
              "rpa",
              name,
              publishChainSteps(steps),
              constrained ? { key: anchorKey, table: "operation_account" } : null,
            )
              .then(() => {
                setSaving(false)
                message.success("已永久保存")
              })
              .catch(() => message.error("保存失败"))
          }}
        />
      ) : null}
    </div>
  )
}

import { App, Button, Card, Input, Select, Switch } from "antd"
import { type ReactNode, useEffect, useState, type MutableRefObject } from "react"
import { SaveChainDialog } from "./chain-list"
import { saveChain } from "./chain-store"
import {
  type ChainStep,
  chainFingerprint,
  apiByCode,
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
  readonly applyScreen: MutableRefObject<(start: DevicePoint, end: DevicePoint) => string | null>
  readonly canWrite: boolean
  readonly onTest: (name: string, steps: readonly ChainStep[]) => boolean
  readonly skills: readonly SkillSpec[]
}

export const RpaStudio = ({ applyScreen, canWrite, onTest, skills }: RpaStudioProps): ReactNode => {
  const { message } = App.useApp()
  const [steps, setSteps] = useState<ChainStep[]>([])
  const [nextId, setNextId] = useState(1)
  const [pick, setPick] = useState("TouchClick")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = skills.length > 0 ? skills : skillCatalog()
  const [testedKey, setTestedKey] = useState("")
  const [saving, setSaving] = useState(false)
  const fingerprint = chainFingerprint(steps)
  const canSave = canWrite && steps.length > 0 && testedKey === fingerprint

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

  const setScope = (id: number, key: string, internal: boolean): void => {
    setSteps((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, scopes: { ...item.scopes, [key]: internal ? "internal" : "external" } }
          : item,
      ),
    )
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
          <Button
            disabled={steps.length === 0}
            onClick={() => {
              const ok = onTest("RPA草稿", steps)
              if (ok) {
                setTestedKey(fingerprint)
                message.success("测试成功，可以保存为行为链")
              }
            }}
          >
            测试
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
                {Object.keys(item.params).map((key) => (
                  <div className="rpa-param" key={key}>
                    <Input
                      addonBefore={paramLabel(apiByCode(item.api), key)}
                      aria-label={`${item.api}-${key}`}
                      onChange={(event) => patchStep(item.id, key, event.target.value)}
                      value={item.params[key]}
                    />
                    <Switch
                      aria-label={`${item.api}-${key}-范围`}
                      checked={item.scopes[key] !== "external"}
                      checkedChildren="内部"
                      onChange={(internal) => setScope(item.id, key, internal)}
                      size="small"
                      unCheckedChildren="外部"
                    />
                  </div>
                ))}
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
                  <label>
                    <Switch
                      aria-label={`${item.api}-广告通过`}
                      checked={(item.guards ?? []).includes("ad")}
                      onChange={(on) => setGuard(item.id, "ad", on)}
                      size="small"
                    />
                    广告通过
                  </label>
                  <label>
                    <Switch
                      aria-label={`${item.api}-转码通过`}
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
      {saving ? (
        <SaveChainDialog
          onCancel={() => setSaving(false)}
          onSubmit={(name) => {
            void saveChain("rpa", name, publishChainSteps(steps))
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

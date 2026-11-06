import { App, Button, Form, Input, Modal, Radio, Select, Slider, Switch } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { combineChecks } from "../../components/tables/operation-controls"
import { createDispatchApi, type DispatchMediaFile, type DispatchOptions } from "./dispatch-api"
import { type CloudInstance, DispatchCloudPick } from "./dispatch-cloud"
import {
  chipOptions,
  DispatchFilterCard,
  DrawSwitch,
  type FilterCardValue,
} from "./dispatch-filter-card"

type DispatchFormProps = {
  readonly groupId: string
  readonly onCancel: () => void
  readonly onCreated: () => void
}

const emptyOptions = (): DispatchOptions => ({
  accountGroups: [],
  accountTags: [],
  accounts: [],
  boxGroups: [],
  boxRemarks: [],
  chains: [],
  devices: [],
  pits: [1, 2, 3, 4, 5],
  pools: [],
  proxies: [],
  proxyGroups: [],
  proxyRemarks: [],
  languages: [],
  proxyTags: [],
  regions: [],
  taskChains: [],
  textTags: [],
  texts: [],
})

const emptyCard = (): FilterCardValue => ({ ids: [], keyword: "", mode: "and", selected: {} })

const cardIdle = (value: FilterCardValue | undefined): boolean =>
  value === undefined ||
  (value.keyword.trim().length === 0 &&
    Object.values(value.selected).every((names) => names.length === 0))

const includesText = (value: string, keyword: string): boolean =>
  value.toLowerCase().includes(keyword.trim().toLowerCase())

const remarkNames = (note: string): string[] =>
  note
    .split("\u001e")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

const textLabels = (item: DispatchOptions["texts"][number]): string[] => {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of [item.category, ...item.tags]) {
    const name = raw.trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

const boxLabel = (box: DispatchOptions["devices"][number]): string =>
  box.name.length > 0 && box.name !== box.host ? `${box.name} ${box.host}` : box.host

const uploadCount = (raw: string): number | null => {
  const text = raw.trim()
  if (text.length === 0) return 1
  if (!/^(?:[1-9]\d{0,2}|1000)$/.test(text)) return null
  return Number(text)
}

const regionSkills = new Set([
  "UpdateFingerprint",
  "SetLanguageCountry",
  "CreateAndroid",
  "ResetAndroidContainer",
  "SwitchAndroidPhoneModel",
])

const languageSkills = new Set(["SetLanguageCountry", "UpdateFingerprint"])

type RepeatDraft =
  | { readonly count: string; readonly mode: "fixed" }
  | { readonly max: string; readonly min: string; readonly mode: "range" }

const fixedDraft = (count: string): RepeatDraft => ({ count, mode: "fixed" })

const parseCount = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null
  const count = Number(raw)
  return count >= 1 && count <= 99 ? count : null
}

export const DispatchForm = ({ groupId, onCancel, onCreated }: DispatchFormProps): ReactNode => {
  const { message } = App.useApp()
  const [options, setOptions] = useState<DispatchOptions>(emptyOptions)
  const [taskChainId, setTaskChainId] = useState<string | null>(null)
  const [repeats, setRepeats] = useState<Record<number, RepeatDraft>>({})
  const [retries, setRetries] = useState<Record<number, { limit: string; on: boolean }>>({})
  const [refreshes, setRefreshes] = useState<Record<string, boolean>>({})
  const [accountCard, setAccountCard] = useState<FilterCardValue>(emptyCard)
  const [cloud, setCloud] = useState<{
    instances: readonly CloudInstance[]
    pitRange: readonly number[]
  }>({ instances: [], pitRange: [1, 2, 3, 4, 5] })
  const [proxyCard, setProxyCard] = useState<FilterCardValue>(emptyCard)
  const [textCards, setTextCards] = useState<Record<string, FilterCardValue>>({})
  const [mediaCards, setMediaCards] = useState<Record<string, FilterCardValue>>({})
  const [mediaDraw, setMediaDraw] = useState<Record<string, "random" | "sequence">>({})
  const [mediaFiles, setMediaFiles] = useState<Record<string, readonly DispatchMediaFile[]>>({})
  const [continent, setContinent] = useState<(typeof options.regions)[number]["name"]>("美洲")
  const [region, setRegion] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [chances, setChances] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const taskChain = options.taskChains.find((item) => item.id === taskChainId) ?? null
  const stages = taskChain?.stages ?? []
  const needsAccount = stages.some((stage) => stage.anchor !== null)
  const needsRegion = stages.some((stage) => stage.steps.some((step) => regionSkills.has(step.api)))
  const needsLanguage = stages.some((stage) =>
    stage.steps.some((step) => languageSkills.has(step.api)),
  )
  const regionCountries = options.regions.find((item) => item.name === continent)?.countries ?? []
  const chanceSteps = stages.flatMap((stage) =>
    stage.steps.flatMap((step, sequence) =>
      step.api === "ClickJumpNodes" &&
      step.scopes.clickChance === "external" &&
      step.sources.clickChance === "chance.external"
        ? [
            {
              chainName: stage.chainName,
              remark: (step.remark ?? "").trim(),
              sequence,
              stage: stage.position,
            },
          ]
        : [],
    ),
  )
  const textSteps = stages.flatMap((stage) =>
    stage.steps.flatMap((step, sequence) =>
      step.api === "SendText" &&
      step.scopes.text === "external" &&
      step.sources.text === "pool.text"
        ? [
            {
              chainName: stage.chainName,
              remark: (step.remark ?? "").trim(),
              sequence,
              stage: stage.position,
            },
          ]
        : [],
    ),
  )
  const mediaSteps = stages.flatMap((stage) =>
    stage.steps.flatMap((step, sequence) => {
      const kinds: ("image" | "video")[] = []
      if (step.api === "UploadPitImage") kinds.push("image")
      if (step.api === "UploadPitVideo") kinds.push("video")
      for (const [key, source] of Object.entries(step.sources)) {
        if (step.scopes[key] !== "external") continue
        if (source === "media.image_id" && !kinds.includes("image")) kinds.push("image")
        if (source === "media.video_id" && !kinds.includes("video")) kinds.push("video")
      }
      const saved = (step.params?.["上传次数"] ?? "").trim()
      const preset = /^(?:[1-9]\d{0,2}|1000)$/.test(saved) ? saved : "1"
      return kinds.map((kind) => ({
        chainName: stage.chainName,
        kind,
        nas: step.params?.["useNas"] === "on",
        nasId: step.params?.["nasId"] ?? "",
        preset,
        sequence,
        stage: stage.position,
        upload:
          (kind === "image" && step.api === "UploadPitImage") ||
          (kind === "video" && step.api === "UploadPitVideo"),
      }))
    }),
  )
  const mediaQuery = mediaSteps
    .map((item) =>
      item.nas
        ? `${item.stage}:${item.sequence}:${item.kind}:nas:${item.nasId}`
        : `${item.stage}:${item.sequence}:${item.kind}:box:${options.devices.map((device) => device.id).join(",")}`,
    )
    .join("|")
  // mediaQuery already encodes the steps and the device ids this effect reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mediaQuery is the stable key
  useEffect(() => {
    let cancelled = false
    for (const item of mediaSteps) {
      const key = `${item.stage}:${item.sequence}:${item.kind}`
      const load = async (): Promise<readonly DispatchMediaFile[]> => {
        const api = createDispatchApi(groupId)
        if (item.nas) {
          return item.nasId.length === 0 ? [] : api.mediaFiles(item.kind, { nasId: item.nasId })
        }
        const lists = await Promise.all(
          options.devices.map((device) => api.mediaFiles(item.kind, { deviceId: device.id })),
        )
        return lists.flat()
      }
      void load()
        .then((files) => {
          if (!cancelled) setMediaFiles((current) => ({ ...current, [key]: files }))
        })
        .catch(() => {
          if (!cancelled) setMediaFiles((current) => ({ ...current, [key]: [] }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [groupId, mediaQuery])
  const repeatDraft = (stage: number): RepeatDraft => repeats[stage] ?? fixedDraft("1")
  const repeatReady = (stage: number): boolean => {
    const draft = repeatDraft(stage)
    if (draft.mode === "fixed") return parseCount(draft.count) !== null
    const min = parseCount(draft.min)
    const max = parseCount(draft.max)
    return min !== null && max !== null && min <= max
  }

  useEffect(() => {
    void createDispatchApi(groupId)
      .options()
      .then(setOptions)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }, [groupId, message])

  const submit = (): void => {
    if (taskChainId === null) {
      message.error("请选择任务链")
      return
    }
    if (
      stages.some((stage) => {
        const draft = repeatDraft(stage.position)
        return draft.mode === "fixed" && !repeatReady(stage.position)
      })
    ) {
      message.error("循环次数为 1 到 99")
      return
    }
    if (
      stages.some((stage) => {
        const draft = repeatDraft(stage.position)
        return draft.mode === "range" && !repeatReady(stage.position)
      })
    ) {
      message.error("随机范围为 1 到 99，且最少不能大于最多")
      return
    }
    const retryRows = stages.flatMap((stage) => {
      const draft = retries[stage.position]
      if (draft?.on !== true) return []
      const limit = parseCount(draft.limit)
      return limit === null
        ? [{ limit: 0, stage: stage.position }]
        : [{ limit, stage: stage.position }]
    })
    if (retryRows.some((item) => item.limit < 1 || item.limit > 9)) {
      message.error("自动重跑次数为 1 到 9")
      return
    }
    if (cloud.pitRange.length === 0) {
      message.error("请选择坑位范围")
      return
    }
    if (cloud.instances.length === 0) {
      message.error("请选择坑位")
      return
    }
    if (needsAccount && (cardIdle(accountCard) || accountCard.ids.length === 0)) {
      message.error("请选择账号")
      return
    }
    if (needsRegion && region === null) {
      message.error("请选择地区")
      return
    }
    if (needsLanguage && language === null) {
      message.error("请选择语言")
      return
    }
    if (
      textSteps.some((item) => {
        const card = textCards[`${item.stage}:${item.sequence}`]
        return cardIdle(card) || (card?.ids.length ?? 0) === 0
      })
    ) {
      message.error("请选择文本池")
      return
    }
    const badLimit = mediaSteps.find((item) => {
      if (!item.upload) return false
      return (
        uploadCount(limits[`${item.stage}:${item.sequence}:${item.kind}`] ?? item.preset) === null
      )
    })
    if (badLimit !== undefined) {
      message.error("上传次数无效")
      return
    }
    const missingNas = mediaSteps.find((item) => item.nas && item.nasId.length === 0)
    if (missingNas !== undefined) {
      message.error("请选择 NAS")
      return
    }
    const missingMedia = mediaSteps.find((item) => {
      const card = mediaCards[`${item.stage}:${item.sequence}:${item.kind}`]
      return cardIdle(card) || (card?.ids.length ?? 0) === 0
    })
    if (missingMedia !== undefined) {
      message.error(missingMedia.kind === "video" ? "请选择视频目录" : "请选择图片目录")
      return
    }
    setSaving(true)
    void createDispatchApi(groupId)
      .create({
        media: mediaSteps.map((item) => {
          const key = `${item.stage}:${item.sequence}:${item.kind}`
          const card = mediaCards[key] ?? emptyCard()
          return {
            boxes: [...(card.selected["box"] ?? [])],
            directories: [...(card.selected["directory"] ?? [])],
            draw: mediaDraw[key] ?? "sequence",
            ids: [...card.ids],
            keyword: card.keyword,
            kind: item.kind,
            limit: item.upload ? (uploadCount(limits[key] ?? item.preset) ?? 1) : 1,
            mode: card.mode,
            ...(item.nas ? { nasId: item.nasId } : {}),
            sequence: item.sequence,
            stage: item.stage,
          }
        }),
        instances: cloud.instances,
        pitRange: cloud.pitRange,
        ...(retryRows.length === 0
          ? {}
          : {
              retries: retryRows.map((item) => ({
                auto: true as const,
                limit: item.limit,
                stage: item.stage,
              })),
            }),
        ...(stages.some((stage) => refreshes[String(stage.position)] === true)
          ? {
              refreshStages: stages.flatMap((stage) =>
                refreshes[String(stage.position)] === true ? [stage.position] : [],
              ),
            }
          : {}),
        repeats: stages.flatMap((stage) => {
          const draft = repeatDraft(stage.position)
          if (draft.mode === "range") {
            const min = parseCount(draft.min)
            const max = parseCount(draft.max)
            return min === null || max === null
              ? []
              : [{ max, min, mode: "range" as const, stage: stage.position }]
          }
          const count = parseCount(draft.count)
          return count === null || count === 1
            ? []
            : [{ count, mode: "fixed" as const, stage: stage.position }]
        }),
        taskChainId,
        ...(chanceSteps.length === 0
          ? {}
          : {
              chances: chanceSteps.map((item) => ({
                sequence: item.sequence,
                stage: item.stage,
                value: chances[`${item.stage}:${item.sequence}`] ?? 100,
              })),
            }),
        texts: textSteps.map((item) => {
          const card = textCards[`${item.stage}:${item.sequence}`] ?? emptyCard()
          return {
            ids: [...card.ids],
            keyword: card.keyword,
            mode: card.mode,
            sequence: item.sequence,
            stage: item.stage,
            tags: [...(card.selected["pool"] ?? [])],
          }
        }),
        ...(needsAccount
          ? {
              accounts: {
                groups: (accountCard.selected["group"] ?? []).filter((name) => name !== "未分组"),
                ids: [...accountCard.ids],
                keyword: accountCard.keyword,
                mode: accountCard.mode,
                tags: [...(accountCard.selected["tag"] ?? [])],
                ungrouped: (accountCard.selected["group"] ?? []).includes("未分组"),
              },
            }
          : {}),
        ...(needsRegion && region !== null ? { region } : {}),
        ...(needsLanguage && language !== null ? { language } : {}),
        ...(cardIdle(proxyCard) || proxyCard.ids.length === 0
          ? {}
          : {
              proxies: {
                groups: [...(proxyCard.selected["group"] ?? [])],
                ids: [...proxyCard.ids],
                keyword: proxyCard.keyword,
                mode: proxyCard.mode,
                remarks: [...(proxyCard.selected["remark"] ?? [])],
              },
            }),
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
      width={940}
    >
      <Form labelCol={{ style: { width: 110 } }} layout="horizontal" size="small">
        <Form.Item
          className="dispatch-choice"
          label="选择任务"
          labelCol={{ style: { width: "100%" } }}
          required
        >
          <Select
            aria-label="选择任务"
            onChange={(value: string) => {
              setTaskChainId(value)
              setAccountCard(emptyCard())
              setProxyCard(emptyCard())
              setTextCards({})
              setMediaCards({})
              setMediaDraw({})
              setMediaFiles({})
              setCloud({ instances: [], pitRange: [1, 2, 3, 4, 5] })
              setContinent("美洲")
              setRegion(null)
              setLanguage(null)
              setRepeats({})
              setRetries({})
              setRefreshes({})
              setLimits({})
              setChances({})
            }}
            options={options.taskChains.map((item) => ({ label: item.name, value: item.id }))}
            placeholder="请选择任务链"
            value={taskChainId}
            virtual={false}
          />
        </Form.Item>
        {stages.length > 0 ? (
          <div className="dispatch-repeat-list">
            {stages.map((stage) => {
              const draft = repeatDraft(stage.position)
              const duplicated =
                stages.filter((item) => item.chainName === stage.chainName).length > 1
              const order = stage.position + 1
              return (
                <div className="dispatch-repeat" key={stage.position}>
                  <div className="dispatch-repeat-name">
                    {stage.chainName}
                    {duplicated ? (
                      <span className="dispatch-repeat-index">第 {order} 段</span>
                    ) : null}
                  </div>
                  <div className="dispatch-repeat-control">
                    <Radio.Group
                      aria-label={`${stage.chainName}第${order}段循环方式`}
                      onChange={(event) => {
                        const mode = event.target.value as "fixed" | "range"
                        setRepeats((current) => {
                          const previous = current[stage.position] ?? fixedDraft("1")
                          if (mode === "range") {
                            const count = previous.mode === "fixed" ? previous.count : previous.min
                            const next = parseCount(count) === null ? "1" : count
                            return {
                              ...current,
                              [stage.position]: { max: next, min: next, mode: "range" },
                            }
                          }
                          const count = previous.mode === "range" ? previous.min : previous.count
                          return {
                            ...current,
                            [stage.position]: fixedDraft(parseCount(count) === null ? "1" : count),
                          }
                        })
                      }}
                      value={draft.mode}
                    >
                      <Radio value="fixed">固定</Radio>
                      <Radio value="range">随机范围</Radio>
                    </Radio.Group>
                    {draft.mode === "fixed" ? (
                      <Input
                        aria-label={`${stage.chainName}第${order}段固定次数`}
                        onChange={(event) =>
                          setRepeats((current) => ({
                            ...current,
                            [stage.position]: fixedDraft(event.target.value),
                          }))
                        }
                        value={draft.count}
                      />
                    ) : (
                      <>
                        <Input
                          aria-label={`${stage.chainName}第${order}段最少次数`}
                          onChange={(event) =>
                            setRepeats((current) => ({
                              ...current,
                              [stage.position]: { ...draft, min: event.target.value },
                            }))
                          }
                          value={draft.min}
                        />
                        到
                        <Input
                          aria-label={`${stage.chainName}第${order}段最多次数`}
                          onChange={(event) =>
                            setRepeats((current) => ({
                              ...current,
                              [stage.position]: { ...draft, max: event.target.value },
                            }))
                          }
                          value={draft.max}
                        />
                      </>
                    )}
                    <Switch
                      aria-label={`${stage.chainName}第${order}段自动重试`}
                      checked={retries[stage.position]?.on === true}
                      onChange={(checked) =>
                        setRetries((current) => ({
                          ...current,
                          [stage.position]: {
                            limit: current[stage.position]?.limit ?? "1",
                            on: checked,
                          },
                        }))
                      }
                    />
                    <span>自动重试</span>
                    {retries[stage.position]?.on === true ? (
                      <Input
                        aria-label={`${stage.chainName}第${order}段自动重跑次数`}
                        onChange={(event) =>
                          setRetries((current) => ({
                            ...current,
                            [stage.position]: { limit: event.target.value, on: true },
                          }))
                        }
                        value={retries[stage.position]?.limit ?? "1"}
                      />
                    ) : null}
                    <Switch
                      aria-label={`${stage.chainName}第${order}段重试更新`}
                      checked={refreshes[String(stage.position)] === true}
                      onChange={(checked) =>
                        setRefreshes((current) => ({
                          ...current,
                          [String(stage.position)]: checked,
                        }))
                      }
                    />
                    <span>重试更新</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {needsAccount ? (
          <DispatchFilterCard
            columns={["账号", "分组", "标签"]}
            idle="请选择账号"
            lines={[
              {
                key: "group",
                options: chipOptions(
                  ["未分组", ...options.accountGroups],
                  (name) =>
                    options.accounts.filter((item) =>
                      name === "未分组" ? item.group.length === 0 : item.group === name,
                    ).length,
                ),
                title: "分组",
                tone: "group",
              },
              {
                key: "tag",
                options: chipOptions(
                  options.accountTags,
                  (name) => options.accounts.filter((item) => item.tags.includes(name)).length,
                ),
                title: "标签",
                tone: "remark",
              },
            ]}
            onChange={setAccountCard}
            placeholder="账号"
            prepare={(value) =>
              options.accounts
                .filter((item) =>
                  combineChecks(value.mode, [
                    ...(value.selected["group"] ?? []).map((name) =>
                      name === "未分组" ? item.group.length === 0 : item.group === name,
                    ),
                    ...(value.selected["tag"] ?? []).map((name) => item.tags.includes(name)),
                    value.keyword.trim().length === 0
                      ? null
                      : includesText(item.identifier, value.keyword),
                  ]),
                )
                .map((item) => ({
                  cells: [
                    item.identifier,
                    item.group.length === 0 ? "未分组" : item.group,
                    item.tags.join("、") || "—",
                  ],
                  id: item.id,
                }))
            }
            key={`account:${taskChainId ?? ""}`}
            required
            title="选择账号"
            unit="个账号"
          />
        ) : null}
        {taskChain === null ? null : (
          <Form.Item
            className="dispatch-choice"
            label="选择坑位"
            labelCol={{ style: { width: "100%" } }}
            required
          >
            <DispatchCloudPick key={taskChain.id} onChange={setCloud} />
          </Form.Item>
        )}
        {needsRegion ? (
          <Form.Item
            className="dispatch-choice"
            label="选择地区"
            labelCol={{ style: { width: "100%" } }}
            required
          >
            <div className="dispatch-region">
              {options.regions.map((item) => (
                <Button
                  key={item.name}
                  onClick={() => setContinent(item.name)}
                  type={continent === item.name ? "primary" : "default"}
                >
                  {item.name}
                </Button>
              ))}
            </div>
            <div className="dispatch-region-countries">
              {regionCountries.map((country) => (
                <Button
                  key={country.code}
                  onClick={() => setRegion(country.code)}
                  type={region === country.code ? "primary" : "default"}
                >
                  {country.name}
                </Button>
              ))}
            </div>
          </Form.Item>
        ) : null}
        {needsLanguage ? (
          <Form.Item
            className="dispatch-choice"
            label="选择语言"
            labelCol={{ style: { width: "100%" } }}
            required
          >
            <div className="dispatch-region">
              {options.languages.map((item) => (
                <Button
                  key={item.code}
                  onClick={() => setLanguage(item.code)}
                  type={language === item.code ? "primary" : "default"}
                >
                  {item.name}
                </Button>
              ))}
            </div>
          </Form.Item>
        ) : null}
        {chanceSteps.length > 0 ? (
          <Form.Item
            className="dispatch-choice"
            label="点击概率"
            labelCol={{ style: { width: "100%" } }}
            required
          >
            <div className="dispatch-chance-list">
              {chanceSteps.map((item) => {
                const key = `${item.stage}:${item.sequence}`
                const value = chances[key] ?? 100
                return (
                  <div className="dispatch-chance" key={key}>
                    <div className="dispatch-chance-head">
                      <div className="dispatch-chance-name">
                        {item.remark.length > 0 ? item.remark : "点击概率"}
                      </div>
                      <span className="dispatch-chance-value">{value}%</span>
                    </div>
                    <Slider
                      aria-label={`${item.chainName}第 ${item.sequence + 1} 步点击概率`}
                      max={100}
                      min={0}
                      onChange={(next) => setChances((current) => ({ ...current, [key]: next }))}
                      step={1}
                      tooltip={{ formatter: (next) => `${next ?? 0}%` }}
                      value={value}
                    />
                  </div>
                )
              })}
            </div>
          </Form.Item>
        ) : null}
        <DispatchFilterCard
          columns={["名字", "分组", "地址", "备注"]}
          idle={needsAccount ? "不选则用账号上一次的代理" : "不选则不使用代理"}
          lines={[
            {
              key: "group",
              options: chipOptions(
                options.proxyGroups,
                (name) => options.proxies.filter((item) => item.group === name).length,
              ),
              title: "分组",
              tone: "group",
            },
            {
              key: "remark",
              options: chipOptions(
                options.proxyRemarks,
                (name) =>
                  options.proxies.filter((item) => remarkNames(item.note).includes(name)).length,
              ),
              title: "备注",
              tone: "remark",
            },
          ]}
          onChange={setProxyCard}
          placeholder="名字 / 地址 / 备注 / 分组"
          prepare={(value) =>
            options.proxies
              .filter((item) => {
                const remarks = remarkNames(item.note)
                return combineChecks(value.mode, [
                  ...(value.selected["group"] ?? []).map((name) => item.group === name),
                  ...(value.selected["remark"] ?? []).map((name) => remarks.includes(name)),
                  value.keyword.trim().length === 0
                    ? null
                    : [item.name, item.address, item.group, ...remarks].some((field) =>
                        includesText(field, value.keyword),
                      ),
                ])
              })
              .map((item) => ({
                cells: [
                  item.name,
                  item.group || "—",
                  item.address,
                  remarkNames(item.note).join("、") || "—",
                ],
                id: item.id,
              }))
          }
          key={`proxy:${taskChainId ?? ""}`}
          title="选择代理"
          unit="个代理"
        />
        {mediaSteps.map((item) => {
          const key = `${item.stage}:${item.sequence}:${item.kind}`
          const files = mediaFiles[key] ?? []
          const directoryName = (directory: string): string =>
            directory.length === 0 ? "根目录" : directory
          const directories = [...new Set(files.map((file) => directoryName(file.directory)))]
          return (
            <DispatchFilterCard
              columns={item.nas ? ["文件", "目录"] : ["文件", "盒子", "目录"]}
              extra={
                <span className="dispatch-draw-row">
                  <DrawSwitch
                    onChange={(next) => setMediaDraw((current) => ({ ...current, [key]: next }))}
                    value={mediaDraw[key] ?? "sequence"}
                  />
                  {item.upload ? (
                    <Input
                      aria-label={`${item.chainName}第 ${item.sequence + 1} 步上传N次后删除`}
                      onChange={(event) =>
                        setLimits((current) => ({ ...current, [key]: event.target.value }))
                      }
                      placeholder="上传N次后删除"
                      style={{ width: 156 }}
                      value={limits[key] ?? ""}
                    />
                  ) : null}
                </span>
              }
              idle={item.kind === "video" ? "请选择视频目录" : "请选择图片目录"}
              key={`${taskChainId ?? ""}:${key}`}
              lines={
                item.nas
                  ? [
                      {
                        key: "directory",
                        options: chipOptions(
                          directories,
                          (name) =>
                            files.filter((file) => directoryName(file.directory) === name).length,
                        ),
                        title: "目录",
                        tone: "remark" as const,
                      },
                    ]
                  : [
                      {
                        key: "box",
                        options: chipOptions(
                          options.devices.map((device) => device.id),
                          (id) => files.filter((file) => file.deviceId === id).length,
                        ).map((option) => ({
                          ...option,
                          label: `${boxLabel(options.devices.find((device) => device.id === option.value) ?? { host: option.value, id: option.value, name: "" })}(${files.filter((file) => file.deviceId === option.value).length})`,
                        })),
                        title: "盒子",
                        tone: "group" as const,
                      },
                      {
                        key: "directory",
                        options: chipOptions(
                          directories,
                          (name) =>
                            files.filter((file) => directoryName(file.directory) === name).length,
                        ),
                        title: "目录",
                        tone: "remark" as const,
                      },
                    ]
              }
              onChange={(next) => setMediaCards((current) => ({ ...current, [key]: next }))}
              placeholder="目录"
              prepare={(value) =>
                files
                  .filter((file) =>
                    combineChecks(value.mode, [
                      ...(value.selected["box"] ?? []).map((id) => file.deviceId === id),
                      ...(value.selected["directory"] ?? []).map(
                        (name) => directoryName(file.directory) === name,
                      ),
                      value.keyword.trim().length === 0
                        ? null
                        : includesText(directoryName(file.directory), value.keyword),
                    ]),
                  )
                  .map((file) => ({
                    cells: item.nas
                      ? [file.name, directoryName(file.directory)]
                      : [
                          file.name,
                          boxLabel(
                            options.devices.find((device) => device.id === file.deviceId) ?? {
                              host: file.deviceId,
                              id: file.deviceId,
                              name: "",
                            },
                          ),
                          directoryName(file.directory),
                        ],
                    id: file.id,
                  }))
              }
              title={
                item.nas
                  ? `${item.chainName} · 第 ${item.sequence + 1} 步 NAS 目录`
                  : `${item.chainName} · 第 ${item.sequence + 1} 步${item.kind === "image" ? "图片" : "视频"}目录`
              }
              unit={item.kind === "video" ? "个视频" : "张图片"}
            />
          )
        })}
        {textSteps.map((item) => {
          const name = item.remark.length > 0 ? item.remark : "输入文字"
          const key = `${item.stage}:${item.sequence}`
          return (
            <DispatchFilterCard
              columns={["文本池", "内容", "说明"]}
              idle="请选择文本池"
              lines={[
                {
                  key: "pool",
                  options: chipOptions(
                    options.textTags,
                    (tag) => options.texts.filter((text) => textLabels(text).includes(tag)).length,
                  ),
                  title: "文本池",
                  tone: "remark",
                },
              ]}
              onChange={(next) => setTextCards((current) => ({ ...current, [key]: next }))}
              placeholder="分组 / 内容 / 说明"
              prepare={(value) =>
                options.texts
                  .filter((text) => {
                    const labels = textLabels(text)
                    return combineChecks(value.mode, [
                      ...(value.selected["pool"] ?? []).map((tag) => labels.includes(tag)),
                      value.keyword.trim().length === 0
                        ? null
                        : [...labels, text.content, text.remark].some((field) =>
                            includesText(field, value.keyword),
                          ),
                    ])
                  })
                  .map((text) => ({
                    cells: [text.category, text.content, text.remark || "—"],
                    id: text.id,
                  }))
              }
              key={`${taskChainId ?? ""}:${key}`}
              required
              title={name}
              unit="条文案"
            />
          )
        })}
      </Form>
    </Modal>
  )
}

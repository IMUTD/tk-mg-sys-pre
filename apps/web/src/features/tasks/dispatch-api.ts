export type DispatchChainStep = {
  readonly api: string
  readonly params?: Readonly<Record<string, string>>
  readonly remark?: string
  readonly scopes: Readonly<Record<string, string>>
  readonly sources: Readonly<Record<string, string>>
}

export type DispatchAccountChoice = {
  readonly group: string
  readonly id: string
  readonly identifier: string
  readonly tags: readonly string[]
}

export type DispatchProxyChoice = {
  readonly address: string
  readonly group: string
  readonly id: string
  readonly name: string
  readonly note: string
}

export type DispatchTextChoice = {
  readonly category: string
  readonly content: string
  readonly id: string
  readonly remark: string
  readonly tags: readonly string[]
}

export type DispatchMediaFile = {
  readonly deviceId: string
  readonly directory: string
  readonly id: string
  readonly name: string
}

export type DispatchOptions = {
  readonly accountGroups: readonly string[]
  readonly accountTags: readonly string[]
  readonly accounts: readonly DispatchAccountChoice[]
  readonly proxies: readonly DispatchProxyChoice[]
  readonly texts: readonly DispatchTextChoice[]
  readonly boxGroups: readonly string[]
  readonly boxRemarks: readonly string[]
  readonly chains: readonly {
    readonly id: string
    readonly name: string
    readonly steps: readonly DispatchChainStep[]
  }[]
  readonly devices: readonly { readonly host: string; readonly id: string; readonly name: string }[]
  readonly pits: readonly number[]
  readonly pools: readonly { readonly id: string; readonly key: string }[]
  readonly proxyGroups: readonly string[]
  readonly proxyRemarks: readonly string[]
  readonly proxyTags: readonly string[]
  readonly languages: readonly { readonly code: string; readonly name: string }[]
  readonly regions: readonly {
    readonly countries: readonly { readonly code: string; readonly name: string }[]
    readonly name: "美洲" | "亚洲" | "欧洲" | "非洲" | "大洋洲"
  }[]
  readonly taskChains: readonly {
    readonly id: string
    readonly name: string
    readonly stages: readonly {
      readonly anchor: null | {
        readonly key: "id" | "identifier"
        readonly table: "operation_account"
      }
      readonly chainId: string
      readonly chainName: string
      readonly position: number
      readonly steps: readonly DispatchChainStep[]
    }[]
  }[]
  readonly textTags: readonly string[]
}

export type ProgressTone = "exception" | "normal" | "partial" | "success"

export type DispatchAccount = {
  readonly account: string
  readonly deviceHost: string
  readonly deviceId: string
  readonly deviceName: string
  readonly id: string
  readonly instanceIndex: number | null
  readonly missing: readonly string[]
  readonly proxyEndpoint: string
  readonly runStatus?: string
  readonly status: string
  readonly stepCount: number
  readonly stepFinished: number
  readonly stepTone: ProgressTone
}

export type DispatchRow = {
  readonly accountCount: number
  readonly accounts: readonly DispatchAccount[]
  readonly chainId: string
  readonly chainName: string
  readonly createdAt: string
  readonly finishedAt: string | null
  readonly id: string
  readonly missing: readonly string[]
  readonly name: string
  readonly requesterName: string
  readonly runStatus?: string
  readonly startedAt: string | null
  readonly status: string
  readonly taskCount: number
  readonly taskFinished: number
  readonly taskTone: ProgressTone
}

export type DispatchSegment = {
  readonly note: string
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly stagePosition: number
  readonly steps: readonly {
    readonly errorCode: string
    readonly parameters: Readonly<Record<string, string>>
    readonly sequence: number
    readonly skill: string
    readonly status: string
  }[]
  readonly title: string
}

export type DispatchRecordStep = {
  readonly attempt: number
  readonly autoRetry?: boolean
  readonly autoRetryLimit?: number
  readonly autoUsed?: number
  readonly linked: boolean
  readonly parameters: Readonly<Record<string, string>>
  readonly queuePriority?: number
  readonly refreshExternal?: boolean
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly replayActive?: boolean
  readonly replayOrigin?: string
  readonly sequence: number
  readonly skill: string
  readonly stageName: string
  readonly stagePosition: number
  readonly status: string
  readonly taskId: string
  readonly taskStatus: string
}

export type DispatchRecordTask = {
  readonly account: string
  readonly id: string
  readonly name: string
  readonly runStatus?: string
  readonly started: boolean
  readonly status: string
  readonly steps: readonly DispatchRecordStep[]
}

export type DispatchRecordBox = {
  readonly id: string
  readonly name: string
  readonly tasks: readonly DispatchRecordTask[]
}

export type DispatchCreateInput = {
  readonly accounts?: {
    readonly groups: readonly string[]
    readonly ids: readonly string[]
    readonly keyword: string
    readonly mode: "and" | "or" | "nand"
    readonly tags: readonly string[]
    readonly ungrouped: boolean
  }
  readonly boxes?: { readonly by: "group" | "remark"; readonly name: string }
  readonly instances?: readonly { readonly deviceId: string; readonly index: number }[]
  readonly pitRange?: readonly number[]
  readonly media?: readonly {
    readonly boxes: readonly string[]
    readonly directories: readonly string[]
    readonly draw: "random" | "sequence"
    readonly ids: readonly string[]
    readonly keyword: string
    readonly kind: "image" | "video"
    readonly limit: number
    readonly mode: "and" | "or" | "nand"
    readonly nasId?: string
    readonly sequence: number
    readonly stage: number
  }[]
  readonly files?: readonly {
    readonly deviceId: string
    readonly directory: string
    readonly mode: "random" | "sequence"
    readonly sequence: number
    readonly source: "pool.backup" | "pool.image" | "pool.video"
    readonly stage: number
  }[]
  readonly pitIndexes?: readonly number[]
  readonly proxies?: {
    readonly groups: readonly string[]
    readonly ids: readonly string[]
    readonly keyword: string
    readonly mode: "and" | "or" | "nand"
    readonly remarks: readonly string[]
  }
  readonly language?: string
  readonly region?: string
  readonly refreshes?: readonly { readonly sequence: number; readonly stage: number }[]
  readonly refreshStages?: readonly number[]
  readonly repeats?: readonly (
    | { readonly count: number; readonly mode: "fixed"; readonly stage: number }
    | { readonly max: number; readonly min: number; readonly mode: "range"; readonly stage: number }
  )[]
  readonly retries?: readonly {
    readonly auto: boolean
    readonly limit: number
    readonly stage: number
  }[]
  readonly chances?: readonly {
    readonly sequence: number
    readonly stage: number
    readonly value: number
  }[]
  readonly taskChainId: string
  readonly texts?: readonly {
    readonly ids: readonly string[]
    readonly keyword: string
    readonly mode: "and" | "or" | "nand"
    readonly sequence: number
    readonly stage: number
    readonly tags: readonly string[]
  }[]
}

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as {
    error?: string
    items?: readonly { account?: string; keys?: readonly string[]; sequence?: number }[]
  } | null
  if (body?.error === "dispatch_incomplete") {
    const first = body.items?.[0]
    const where =
      first === undefined ? "" : `${first.account ?? ""} 第 ${(first.sequence ?? 0) + 1} 步`
    return `参数没有写全，不能开始。${where} ${first?.keys?.join("、") ?? ""}`.trim()
  }
  if (body?.error === "no_accounts") return "这个范围内没有账号"
  if (body?.error === "account_required") return "请选择账号"
  if (body?.error === "region_required") return "请选择地区"
  if (body?.error === "region_not_allowed") return "这条任务不用选择地区"
  if (body?.error === "language_required") return "请选择语言"
  if (body?.error === "language_not_allowed") return "这条任务不用选择语言"
  if (body?.error === "chance_required") return "请设置点击概率"
  if (body?.error === "chance_not_allowed") return "这条任务不用设置点击概率"
  if (body?.error === "text_required") return "请选择文本池"
  if (body?.error === "text_not_allowed") return "这条任务不用选择文本池"
  if (body?.error === "text_empty") return "这个文本池是空的"
  if (body?.error === "replay_not_failed") return "只有失败的这一段可以重跑"
  if (body?.error === "replay_in_progress") return "这一段已经在排队或正在执行"
  if (body?.error === "replay_incomplete") return "重新抽取的参数是空的，没有重跑"
  if (body?.error === "account_not_allowed") return "这条任务不能选择账号"
  if (body?.error === "instances_required") return "请选择坑位"
  if (body?.error === "instance_out_of_range") return "请选择坑位范围"
  if (body?.error === "instance_not_found") return "坑位不存在"
  if (body?.error === "media_required" || body?.error === "media_empty") {
    const kind = (body as { mediaKind?: string }).mediaKind
    if (body.error === "media_empty") return kind === "video" ? "没有这个视频" : "没有这张图片"
    return kind === "video" ? "请选择视频目录" : "请选择图片目录"
  }
  if (body?.error === "pool_not_found") return "没有找到这个账号池"
  if (body?.error === "authentication_required") return "请先登录"
  if (body?.error === "permission_denied") return "没有权限"
  return "保存失败"
}

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
  })
  if (!response.ok) throw new Error(await readError(response))
  return response
}

export const createDispatchApi = (groupId: string) => {
  const root = `/api/groups/${groupId}`
  return {
    create: async (input: DispatchCreateInput) => {
      const response = await request(`${root}/dispatches`, {
        body: JSON.stringify(input),
        method: "POST",
      })
      return (await response.json()) as { id: string; status: string }
    },
    list: async () => {
      const response = await request(`${root}/dispatches`)
      return ((await response.json()) as { items: readonly DispatchRow[] }).items
    },
    itemSteps: async (dispatchId: string, itemId: string) => {
      const response = await request(`${root}/dispatches/${dispatchId}/items/${itemId}/steps`)
      return (await response.json()) as { segments: readonly DispatchSegment[] }
    },
    mediaFiles: async (
      kind: "image" | "video",
      query: { readonly deviceId?: string; readonly nasId?: string },
    ) => {
      const params = new URLSearchParams({ kind })
      if (query.deviceId !== undefined) params.set("deviceId", query.deviceId)
      if (query.nasId !== undefined) params.set("nasId", query.nasId)
      const response = await request(`${root}/dispatches/media-files?${params.toString()}`)
      return ((await response.json()) as { files: readonly DispatchMediaFile[] }).files
    },
    directories: async (deviceId: string, source: "pool.backup" | "pool.image" | "pool.video") => {
      const response = await request(
        `${root}/dispatches/directories?deviceId=${encodeURIComponent(deviceId)}&source=${encodeURIComponent(source)}`,
      )
      return (
        (await response.json()) as {
          directories: readonly {
            readonly bucket: string
            readonly count: number
            readonly directory: string
          }[]
        }
      ).directories
    },
    options: async () => {
      const response = await request(`${root}/dispatches/options`)
      return (await response.json()) as DispatchOptions
    },
    clearRecords: async (input: {
      readonly deviceIds?: readonly string[]
      readonly dispatchIds?: readonly string[]
      readonly unassigned?: boolean
    }) => {
      const response = await request(`${root}/dispatch-records/clear`, {
        body: JSON.stringify(input),
        method: "POST",
      })
      return (await response.json()) as { removed: number }
    },
    records: async () => {
      const response = await request(`${root}/dispatch-records`)
      return ((await response.json()) as { boxes: readonly DispatchRecordBox[] }).boxes
    },
    start: async (ids: readonly string[]) => {
      await request(`${root}/dispatches/start`, {
        body: JSON.stringify({ ids }),
        method: "POST",
      })
    },
  }
}

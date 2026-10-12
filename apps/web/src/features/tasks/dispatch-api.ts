export type DispatchChainStep = {
  readonly api: string
  readonly scopes: Readonly<Record<string, string>>
  readonly sources: Readonly<Record<string, string>>
}

export type DispatchOptions = {
  readonly accountNotes: readonly string[]
  readonly accounts: readonly { readonly id: string; readonly identifier: string; readonly note: string }[]
  readonly chains: readonly { readonly id: string; readonly name: string; readonly steps: readonly DispatchChainStep[] }[]
  readonly devices: readonly { readonly host: string; readonly id: string; readonly name: string }[]
  readonly pits: readonly number[]
  readonly proxyTags: readonly string[]
  readonly textTags: readonly string[]
}

export type DispatchAccount = {
  readonly deviceHost: string
  readonly deviceName: string
  readonly id: string
  readonly identifier: string
  readonly instanceIndex: number | null
  readonly missing: readonly string[]
  readonly note: string
  readonly proxyName: string
  readonly status: string
}

export type DispatchRow = {
  readonly accountCount: number
  readonly accounts: readonly DispatchAccount[]
  readonly chainName: string
  readonly id: string
  readonly missing: readonly string[]
  readonly name: string
  readonly status: string
}

export type DispatchRecordStep = {
  readonly parameters: Readonly<Record<string, string>>
  readonly sequence: number
  readonly skill: string
  readonly status: string
}

export type DispatchRecordTask = {
  readonly account: string
  readonly id: string
  readonly name: string
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
  readonly accountIds?: readonly string[]
  readonly accountNote?: string
  readonly boxIds?: readonly string[]
  readonly chainId: string
  readonly pitIndexes?: readonly number[]
  readonly proxyTag?: string | null
  readonly texts?: readonly { readonly mode: "random" | "sequence" | "tag"; readonly sequence: number; readonly tag?: string }[]
}

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as {
    error?: string
    items?: readonly { account?: string; keys?: readonly string[]; sequence?: number }[]
  } | null
  if (body?.error === "dispatch_incomplete") {
    const first = body.items?.[0]
    const where = first === undefined ? "" : `${first.account ?? ""} 第 ${(first.sequence ?? 0) + 1} 步`
    return `参数没有写全，不能开始。${where} ${first?.keys?.join("、") ?? ""}`.trim()
  }
  if (body?.error === "no_accounts") return "没有找到这批账号"
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
    options: async () => {
      const response = await request(`${root}/dispatches/options`)
      return (await response.json()) as DispatchOptions
    },
    clearRecords: async (input: { readonly deviceIds: readonly string[]; readonly unassigned: boolean }) => {
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

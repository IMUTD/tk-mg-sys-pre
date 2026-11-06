export const readRemark = (
  value: unknown,
): { readonly ok: true; readonly remark: string } | { readonly ok: false; readonly error: "备注过长" | "备注无效" } => {
  if (value === undefined) return { ok: true, remark: "" }
  if (typeof value !== "string" || /[\n\r]/.test(value)) return { ok: false, error: "备注无效" }
  const remark = value.trim()
  if (remark.length > 40) return { ok: false, error: "备注过长" }
  return { ok: true, remark }
}

export const readChainName = (
  value: unknown,
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly error: "行为链名无效" } => {
  if (value === undefined || value === null) return { ok: true, name: "" }
  if (typeof value !== "string" || /[\n\r]/.test(value)) return { ok: false, error: "行为链名无效" }
  const name = value.trim()
  if (name.length > 80) return { ok: false, error: "行为链名无效" }
  return { ok: true, name }
}

export const nodeNameOf = (skill: string, catalogName: string | undefined): string => {
  const name = catalogName?.trim() ?? ""
  const label = name.length > 0 ? name : skill
  return label.length > 80 ? label.slice(0, 80) : label
}

export const stepLogTitle = (input: {
  readonly chainName: string
  readonly dispatchItemId: string | null
  readonly nodeName: string
  readonly remark: string
  readonly skill: string
  readonly taskChainId: string | null
  readonly taskChainName: string
  readonly taskName: string
}): string => {
  const chain = input.chainName.trim()
  const remark = input.remark.trim()
  if (chain.length === 0 && remark.length === 0) return ""
  const fromTaskChain = input.taskChainId !== null && input.taskChainId.length > 0
  const fromDispatch = input.dispatchItemId !== null && input.dispatchItemId.length > 0
  const task = fromTaskChain
    ? input.taskChainName.trim().length > 0
      ? input.taskChainName.trim()
      : input.taskName
    : fromDispatch
      ? input.taskName
      : "测试"
  const node = input.nodeName.trim().length > 0 ? input.nodeName.trim() : input.skill
  return `${task}-${chain}-${remark}-${node}`
}

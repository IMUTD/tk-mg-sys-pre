import {
  DeviceCommandIdSchema,
  type DeviceCommandResult,
  DeviceErrorCode,
} from "@tk-mg/device-adapter"

export type RedactedValue =
  | null
  | boolean
  | number
  | {
      readonly type: "string"
      readonly length: number
      readonly redacted: boolean
      readonly value?: string
    }
  | { readonly type: "array"; readonly value: readonly RedactedValue[] }
  | { readonly type: "object"; readonly value: Readonly<Record<string, RedactedValue>> }
  | { readonly type: "unknown"; readonly valueType: string }

const SENSITIVE_KEY =
  /(password|passwd|token|secret|credential|authorization|api[-_]?key|access[-_]?key)/i

const redactValue = (value: unknown, sensitive: boolean): RedactedValue => {
  if (value === null) return null
  if (typeof value === "string") {
    return sensitive
      ? { type: "string", length: value.length, redacted: true }
      : { type: "string", length: value.length, redacted: false, value }
  }
  if (typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value)) {
    return { type: "array", value: value.map((item) => redactValue(item, sensitive)) }
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [
      key,
      redactValue(entry, sensitive || SENSITIVE_KEY.test(key)),
    ])
    return { type: "object", value: Object.fromEntries(entries) }
  }
  return { type: "unknown", valueType: typeof value }
}

export const redactSecrets = (value: unknown): RedactedValue => redactValue(value, false)

const knownErrorCodes: ReadonlySet<string> = new Set([
  ...Object.values(DeviceErrorCode),
  "unknown",
  "ambiguous_submit",
  "cancelled",
])

export const safeExecutionError = (
  code: string | undefined,
  _message: string | undefined,
): {
  readonly code: string
  readonly message: string
} => {
  const normalized = code !== undefined && knownErrorCodes.has(code) ? code : "unknown"
  return {
    code: normalized,
    message: `Device command error (${normalized})`.slice(0, 160),
  }
}

export const safeExecutionResult = (result: DeviceCommandResult) => {
  const commandId = DeviceCommandIdSchema.safeParse(result.commandId)
  if (!commandId.success) throw new Error("Invalid adapter result command ID")
  if (typeof result.retryable !== "boolean") throw new Error("Invalid adapter result retry flag")
  const common = {
    commandId: commandId.data,
    status: result.status,
    retryable: result.retryable,
  }
  switch (result.status) {
    case "queued":
    case "running":
    case "cancelled":
      return common
    case "failed":
    case "timed_out":
      return {
        ...common,
        error: { code: safeExecutionError(result.error.code, result.error.message).code },
      }
    case "succeeded":
      switch (result.outcome.kind) {
        case "acknowledged":
        case "no_artifact":
        case "artifact":
          return { ...common, outcome: { kind: result.outcome.kind } }
        default: {
          const exhaustive: never = result.outcome
          throw new Error(`Invalid adapter outcome: ${typeof exhaustive}`)
        }
      }
    default: {
      const exhaustive: never = result
      throw new Error(`Invalid adapter status: ${typeof exhaustive}`)
    }
  }
}

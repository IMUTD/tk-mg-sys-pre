import { expect, it } from "bun:test"
import { DeviceCommandIdSchema } from "@tk-mg/device-adapter"
import { safeExecutionError, safeExecutionResult } from "./redaction"

const commandId = DeviceCommandIdSchema.parse("66666666-6666-4666-8666-666666666666")

it("removes nested credentials and raw provider text from a failed adapter result", () => {
  const result = {
    commandId,
    status: "failed" as const,
    retryable: true,
    providerReceiptId: "Bearer provider-receipt-secret",
    error: { code: "timeout" as const, message: "request failed: password=raw-provider-secret" },
    telemetry: [
      { password: "nested-password", token: "nested-token", authorization: "nested-auth" },
    ],
  }

  const safe = safeExecutionResult(result)

  expect(safe).toEqual({
    commandId,
    status: "failed",
    retryable: true,
    error: { code: "timeout" },
  })
  expect(JSON.stringify(safe)).not.toMatch(
    /raw-provider-secret|nested-password|nested-token|nested-auth|provider-receipt-secret/,
  )
})

it("retains safe acknowledgement and health-check outcomes without provider extras", () => {
  const acknowledged = safeExecutionResult({
    commandId,
    status: "succeeded",
    retryable: false,
    outcome: { kind: "acknowledged" },
    providerReceiptId: "Authorization: raw-provider-secret",
  })
  const noArtifact = safeExecutionResult({
    commandId,
    status: "succeeded",
    retryable: false,
    outcome: { kind: "no_artifact" },
  })

  expect(acknowledged).toEqual({
    commandId,
    status: "succeeded",
    retryable: false,
    outcome: { kind: "acknowledged" },
  })
  expect(noArtifact).toEqual({
    commandId,
    status: "succeeded",
    retryable: false,
    outcome: { kind: "no_artifact" },
  })
})

it("keeps normalized codes but never persists raw provider error text", () => {
  const safe = safeExecutionError("timeout", "password=raw-provider-secret".repeat(200))
  const hostile = safeExecutionError("Bearer raw-provider-secret", "token=raw-provider-secret")

  expect(safe.code).toBe("timeout")
  expect(hostile.code).toBe("unknown")
  expect(safe.message.length).toBeLessThanOrEqual(160)
  expect(hostile.message.length).toBeLessThanOrEqual(160)
  expect(JSON.stringify({ safe, hostile })).not.toContain("raw-provider-secret")
})

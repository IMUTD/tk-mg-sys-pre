import { describe, expect, it } from "bun:test"
import { DeviceCommandSchema, DeviceErrorCode } from "@tk-mg/device-adapter"
import { parseExecutableCommand, type TaskState, transitionTask } from "./index"

describe("adapter baseline characterization", () => {
  it("preserves the adapter command boundary and error vocabulary", () => {
    const base = {
      commandId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "baseline-key",
      target: { deviceId: "device-1" },
      timeoutMs: 1000,
    }

    expect(DeviceCommandSchema.safeParse({ ...base, type: "tap", x: 1, y: 2 }).success).toBe(true)
    expect(
      DeviceCommandSchema.safeParse({
        ...base,
        type: "tap",
        x: 1,
        y: 2,
        providerToken: "placeholder",
      }).success,
    ).toBe(false)
    expect(DeviceErrorCode.Timeout).toBe("timeout")
  })
})

describe("task execution contracts", () => {
  it("rejects a forbidden transition", () => {
    expect(() => transitionTask("queued", "succeeded")).toThrow()
  })

  it("rejects input_text before encrypted replay storage exists", () => {
    const input = {
      commandId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "input-key",
      target: { deviceId: "device-1" },
      timeoutMs: 1000,
      type: "input_text",
      text: "fixture-placeholder",
    }

    expect(() => parseExecutableCommand(input)).toThrow()
  })

  it("keeps same-state transitions immutable", () => {
    const states: readonly TaskState[] = [
      "queued",
      "dispatching",
      "running",
      "retry_waiting",
      "cancel_requested",
      "succeeded",
      "failed",
      "cancelled",
    ]
    for (const state of states) expect(transitionTask(state, state)).toBe(state)
  })
})

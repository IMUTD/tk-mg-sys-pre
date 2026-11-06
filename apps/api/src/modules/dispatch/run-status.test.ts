import { describe, expect, it } from "bun:test"

import { accountRunStatus, dispatchRunStatus, displayRunStatus } from "./run-status"

describe("dispatch run status", () => {
  it("uses the first stage that is not succeeded and rolls the dispatch up", () => {
    expect(
      accountRunStatus([
        { priority: 0, repeat: 0, stage: 0, status: "succeeded" },
        { priority: 1, repeat: 0, stage: 1, status: "queued" },
        { priority: 0, repeat: 0, stage: 2, status: "failed" },
      ]),
    ).toBe("replaying")
    expect(accountRunStatus([{ priority: 0, repeat: 0, stage: 0, status: "running" }])).toBe("running")
    expect(accountRunStatus([{ priority: 0, repeat: 0, stage: 0, status: "failed" }])).toBe("failed")
    expect(
      accountRunStatus([
        { priority: 0, repeat: 0, stage: 0, status: "succeeded" },
        { priority: 0, repeat: 1, stage: 0, status: "succeeded" },
      ]),
    ).toBe("succeeded")
    expect(dispatchRunStatus(["succeeded", "replaying", "failed"])).toBe("replaying")
    expect(dispatchRunStatus(["succeeded", "failed"])).toBe("partial")
    expect(dispatchRunStatus(["succeeded", "partial"])).toBe("partial")
    expect(dispatchRunStatus(["failed", "failed"])).toBe("failed")
    expect(displayRunStatus("failed", 1, 4)).toBe("partial")
    expect(displayRunStatus("failed", 4, 4)).toBe("failed")
    expect(displayRunStatus("succeeded", 0, 4)).toBe("succeeded")
    expect(dispatchRunStatus(["succeeded", "succeeded"])).toBe("succeeded")
    expect(dispatchRunStatus(["cancelled"])).toBe("")
    expect(dispatchRunStatus(["", ""])).toBe("")
  })
})

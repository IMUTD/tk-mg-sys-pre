import { expect, it } from "bun:test"

import { mixedBatchRejected } from "./pit-chain"

it("allows a pit chain of delete, create, and wait", () => {
  expect(mixedBatchRejected(["BoxDelete", "CreateAndroid", "WaitReady"])).toBe(false)
})

it("allows a single delete", () => {
  expect(mixedBatchRejected(["BoxDelete"])).toBe(false)
})

it("rejects delete mixed with a screen step", () => {
  expect(mixedBatchRejected(["BoxDelete", "TouchClick"])).toBe(true)
})

it("allows deleting extra backups beside an import", () => {
  expect(mixedBatchRejected(["DeleteExtraBackup", "ImportPitBackup"])).toBe(false)
})

it("allows deleting extra backups beside a screen step", () => {
  expect(mixedBatchRejected(["DeleteExtraBackup", "TouchClick"])).toBe(false)
})

it("rejects proxy mixed with wait", () => {
  expect(mixedBatchRejected(["SetProxy", "WaitReady"])).toBe(true)
})

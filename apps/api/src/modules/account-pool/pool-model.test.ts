import { describe, expect, it } from "bun:test"
import { PoolConsumeSchema, PoolSourceFilterSchema, PoolWriteSchema } from "./pool-model"

describe("persisted account pool validation", () => {
  it("rejects unsafe encodings, invalid loop counts and excessive selections", () => {
    const base = { filter: { backType: "3" }, mode: "selected" }
    expect(PoolWriteSchema.safeParse({ ...base, key: "pool+round" }).success).toBe(false)
    expect(PoolWriteSchema.safeParse({ ...base, times: 21 }).success).toBe(false)
    expect(PoolWriteSchema.safeParse({ ...base, times: 0 }).success).toBe(false)
    expect(
      PoolWriteSchema.safeParse({
        ...base,
        accountIds: Array.from({ length: 3001 }, () => crypto.randomUUID()),
      }).success,
    ).toBe(false)
  })
  it("normalizes filters without accepting arbitrary execution instructions", () => {
    const filter = PoolSourceFilterSchema.parse({
      backType: "5",
      command: "not-an-execution-contract",
    })
    expect(filter).toEqual({
      backType: "5",
      deviceId: null,
      deviceSeq: null,
      online: null,
      status: "",
      tag: [],
      tagExclude: [],
      tagInclude: [],
      tagQueryMode: "AND",
    })
    expect(PoolConsumeSchema.safeParse({ round: 0 }).success).toBe(false)
  })
})

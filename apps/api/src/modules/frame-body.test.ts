import { describe, expect, it } from "bun:test"

import { readFrameBody } from "./frame-body"

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new Blob([bytes]).stream()

describe("readFrameBody", () => {
  it("returns the bytes when the body is within the limit", async () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const read = await readFrameBody(streamOf(raw), 8)
    expect(read.kind).toBe("bytes")
    if (read.kind !== "bytes") return
    expect(Array.from(read.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })

  it("drops an empty body", async () => {
    expect(await readFrameBody(streamOf(new Uint8Array()), 8)).toEqual({ kind: "empty" })
    expect(await readFrameBody(null, 8)).toEqual({ kind: "empty" })
  })

  it("cancels a body larger than the limit and does not keep the bytes", async () => {
    const read = await readFrameBody(streamOf(new Uint8Array(6)), 4)
    expect(read).toEqual({ kind: "overflow" })
  })
})

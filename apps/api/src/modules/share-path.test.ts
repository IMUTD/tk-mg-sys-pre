import { describe, expect, it } from "bun:test"

import { directoryOk, fileCategory, isBucket, splitRelative } from "./share-path"

describe("share paths", () => {
  it("keeps the directory of a nested video", () => {
    expect(splitRelative("美女/一月/1.mp4")).toEqual({ name: "1.mp4", parent: "美女/一月" })
    expect(fileCategory("1.mp4")).toBe("video")
    expect(fileCategory("note.txt")).toBe("text")
    expect(fileCategory("cover.PNG")).toBe("image")
    expect(fileCategory("clip.bin")).toBe("other")
    expect(fileCategory("phone.tar.gz")).toBe("other")
    expect(isBucket("backup")).toBe(true)
    expect(isBucket("phones")).toBe(false)
  })

  it("rejects a path that leaves the bucket", () => {
    expect(splitRelative("../share/a.mp4")).toBeNull()
    expect(splitRelative("a\\b.mp4")).toBeNull()
    expect(directoryOk("美女/一月")).toBe(true)
    expect(directoryOk("")).toBe(true)
  })

  it.each(["\0", "\t", "\n", "\r", '"', "'", "`", "$"])(
    "rejects a path segment containing %j",
    (character) => {
      expect(splitRelative(`folder/file${character}.mp4`)).toBeNull()
      expect(directoryOk(`folder/sub${character}directory`)).toBe(false)
    },
  )
})

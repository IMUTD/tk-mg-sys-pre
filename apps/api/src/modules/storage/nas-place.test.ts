import { describe, expect, it } from "bun:test"

import {
  boxDirForNasBucket,
  bucketOk,
  nasCommitShaOk,
  dirNameOk,
  nasDeleteKeyOk,
  nasDirKey,
  nasObjectKey,
  nasTransferAction,
  storageCardItems,
} from "./nas-place"

describe("NAS place rules", () => {
  it("keeps one object key per administrator and file name", () => {
    expect(nasObjectKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "云机")).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/云机",
    )
    expect(nasObjectKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "../云机")).toBeNull()
    expect(dirNameOk("短视频")).toBe(true)
    expect(dirNameOk("a/b")).toBe(false)
    expect(nasDirKey("短视频", "1.mp4")).toBe("短视频/1.mp4")
    expect(nasDirKey("..", "1.mp4")).toBeNull()
    expect(nasDeleteKeyOk("短视频/1.mp4")).toBe(true)
    expect(nasDeleteKeyOk("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/云机")).toBe(true)
    expect(nasDeleteKeyOk("短视频/a/1.mp4")).toBe(false)
    expect(nasDeleteKeyOk("../1.mp4")).toBe(false)
    expect(bucketOk("backup")).toBe(true)
    expect(bucketOk("mbp")).toBe(true)
    expect(bucketOk("Pictures")).toBe(false)
    expect(bucketOk("a/b")).toBe(false)
  })

  it("maps NAS buckets onto box directories and chooses one transfer action", () => {
    expect(boxDirForNasBucket("pictures")).toEqual({ bucket: "share", category: "image" })
    expect(boxDirForNasBucket("videos")).toEqual({ bucket: "video", category: "video" })
    expect(boxDirForNasBucket("backup")).toEqual({ bucket: "backup", category: "other" })
    expect(boxDirForNasBucket("mbp")).toBeNull()
    expect(nasTransferAction("backup", null, "a")).toBe("upload")
    expect(nasTransferAction("backup", "old", "new")).toBe("replace")
    expect(nasTransferAction("image", "same", "same")).toBe("drop")
    expect(nasTransferAction("video", "old", "new")).toBe("drop")
    expect(nasCommitShaOk("box", "backup", "abc", "abc")).toBe(true)
    expect(nasCommitShaOk("box", "image", "abc", "def")).toBe(true)
    expect(nasCommitShaOk("nas", "backup", "old", "new")).toBe(true)
    expect(nasCommitShaOk("nas", "video", "old", "old")).toBe(false)
    expect(storageCardItems({ items: [{ bucket: "videos", id: "card" }, { bucket: 1 }] })).toEqual([
      { bucket: "videos", id: "card" },
    ])
  })
})

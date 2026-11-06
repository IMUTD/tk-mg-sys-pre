import { describe, expect, it } from "bun:test"

import { parseBucketNames, parseListObjects } from "./s3-list"

describe("NAS list xml", () => {
  it("reads bucket names and a truncated object page", () => {
    expect(parseBucketNames("<Buckets><Bucket><Name>hmg-db</Name></Bucket><Bucket><Name>mbp</Name></Bucket></Buckets>")).toEqual([
      "hmg-db",
      "mbp",
    ])
    expect(
      parseListObjects(
        "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;1</NextContinuationToken><Contents><Key>a.mbp</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>12</Size></Contents></ListBucketResult>",
      ),
    ).toEqual({
      items: [{ key: "a.mbp", modified: "2026-01-01T00:00:00.000Z", size: 12 }],
      nextToken: "next&1",
    })
  })
})

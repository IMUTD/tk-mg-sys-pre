import { expect, it } from "bun:test"
import sharp from "sharp"
import { validateIdentityImage } from "./upload"

it("rejects undecodable bytes with a permitted MIME type", async () => {
  // Given / When / Then
  await expect(
    validateIdentityImage(new File(["not png"], "front.png", { type: "image/png" })),
  ).rejects.toMatchObject({ code: "unsupported_image" })
})
it("rejects an oversized image before decoding", async () => {
  // Given / When / Then
  await expect(
    validateIdentityImage(new File([new Uint8Array(2000001)], "front.png", { type: "image/png" })),
  ).rejects.toMatchObject({ code: "image_too_large" })
})
it("rejects images smaller than provider minimum dimensions", async () => {
  // Given
  const bytes = await sharp({
    create: { width: 64, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer()
  // When / Then
  await expect(
    validateIdentityImage(new File([bytes], "front.png", { type: "image/png" })),
  ).rejects.toMatchObject({ code: "unsupported_image" })
})
it("accepts a fully decoded PNG at the permitted dimensions", async () => {
  // Given
  const bytes = await sharp({
    create: { width: 65, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer()
  // When
  const result = await validateIdentityImage(new File([bytes], "front.png", { type: "image/png" }))
  // Then
  expect(result).toEqual(bytes)
})
it("admits at most two concurrent decodes and releases capacity on success", async () => {
  // Given
  const bytes = await sharp({
    create: { width: 65, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer()
  const file = new File([bytes], "front.png", { type: "image/png" })
  // When
  const results = await Promise.allSettled([
    validateIdentityImage(file),
    validateIdentityImage(file),
    validateIdentityImage(file),
  ])
  // Then
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2)
  const rejected = results.find((result) => result.status === "rejected")
  expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
    code: "rate_limited",
    status: 429,
  })
  expect(await validateIdentityImage(file)).toEqual(bytes)
})
it("releases decoder capacity when image decoding fails", async () => {
  // Given
  const badFile = new File(["invalid png"], "front.png", { type: "image/png" })
  const bytes = await sharp({
    create: { width: 65, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer()
  const file = new File([bytes], "front.png", { type: "image/png" })
  await Promise.allSettled([validateIdentityImage(badFile), validateIdentityImage(badFile)])
  // When
  const results = await Promise.allSettled([
    validateIdentityImage(file),
    validateIdentityImage(file),
  ])
  // Then
  expect(results.every((result) => result.status === "fulfilled")).toBe(true)
})

import { expect, it, spyOn } from "bun:test"
import { IncomingMessage } from "node:http"
import { createRequire } from "node:module"
import { Socket } from "node:net"
import { Readable } from "node:stream"
import {
  Id2MetaVerifyWithOCRAdvanceRequest,
  Id2MetaVerifyWithOCRResponseBody,
  Id2MetaVerifyWithOCRResponseBodyResultObject,
} from "@alicloud/cloudauth20190307"
import * as core from "@darabonba/typescript"
import { z } from "zod"
import { parseIdentityConfig } from "./config"
import { createAliyunIdentityClient, createIdentityRuntime } from "./provider"
import { parseProviderResponse } from "./provider-result"

const config = parseIdentityConfig({
  ADMIN_IDENTITY_MODE: "optional",
  ALIBABA_CLOUD_ACCESS_KEY_ID: "test",
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: "test",
  IDENTITY_HMAC_KEY: "0123456789abcdef0123456789abcdef",
})
const sdkTransport = z
  .custom<{ doAction: typeof core.doAction }>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "doAction" in value &&
      typeof value.doAction === "function",
  )
  .parse(createRequire(import.meta.url)("@darabonba/typescript/dist/core"))
const reply = (body: string, statusCode = 200) => {
  const incoming = new IncomingMessage(new Socket())
  incoming.statusCode = statusCode
  incoming.headers = { "content-type": "application/json" }
  incoming.push(Buffer.from(body))
  incoming.push(null)
  return new core.Response(incoming)
}
it("parses actual SDK models while ignoring extra OCR card fields", () => {
  // Given
  const body = new Id2MetaVerifyWithOCRResponseBody({
    code: "200",
    requestId: "req",
    resultObject: new Id2MetaVerifyWithOCRResponseBodyResultObject({
      bizCode: "1",
      cardInfo: JSON.stringify({
        certName: "张三",
        certNo: "11010519491231002X",
        address: "ignored",
        nationality: "ignored",
      }),
    }),
  })
  // When
  const result = parseProviderResponse(body)
  // Then
  expect(result.status).toBe("verified")
})
it("disables retry policy on both the official client and runtime", () => {
  // Given / When
  const client = createAliyunIdentityClient(config)
  const runtime = createIdentityRuntime()
  // Then
  expect(client._retryOptions.retryable).toBe(false)
  expect(runtime.autoretry).toBe(false)
  expect(runtime.connectTimeout).toBe(3000)
  expect(runtime.readTimeout).toBe(10000)
})
for (const failingStage of [1, 2, 3]) {
  it(`does not repeat SDK transport when stage ${failingStage} fails`, async () => {
    // Given
    let calls = 0
    const transport = spyOn(sdkTransport, "doAction").mockImplementation(async () => {
      calls++
      if (calls === failingStage) throw new Error("transport failed with sensitive data")
      if (calls === 1)
        return reply(
          JSON.stringify({
            Bucket: "fixture",
            Endpoint: "oss-cn-beijing.aliyuncs.com",
            ObjectKey: "front",
            AccessKeyId: "fixture",
            EncodedPolicy: "fixture",
            Signature: "fixture",
            UseAccelerate: false,
          }),
        )
      return reply("<PostResponse/>", 201)
    })
    try {
      // When
      const client = createAliyunIdentityClient(config)
      client._openPlatformEndpoint = "127.0.0.1:1"
      const result = await client
        .id2MetaVerifyWithOCRAdvance(
          new Id2MetaVerifyWithOCRAdvanceRequest({ certFileObject: Readable.from("fixture") }),
          createIdentityRuntime(),
        )
        .catch((error: unknown) => error)
      // Then
      expect(calls).toBe(failingStage)
      expect(result).toBeInstanceOf(Error)
    } finally {
      transport.mockRestore()
    }
  })
}

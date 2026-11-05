import { Readable } from "node:stream"
import CloudAuth, { Id2MetaVerifyWithOCRAdvanceRequest } from "@alicloud/cloudauth20190307"
import { $OpenApiUtil } from "@alicloud/openapi-core"
import { RetryOptions, RuntimeOptions } from "@darabonba/typescript"
import { type IdentityConfig, identityProviderAvailable } from "./config"
import { parseProviderResponse } from "./provider-result"
import type { IdentityProvider, ProviderResult } from "./types"

export const createAliyunIdentityClient = (config: IdentityConfig) =>
  new CloudAuth(
    new $OpenApiUtil.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      securityToken: config.securityToken,
      regionId: config.region,
      endpoint: `cloudauth.${config.region}.aliyuncs.com`,
      protocol: "https",
      connectTimeout: 3000,
      readTimeout: 10000,
      retryOptions: new RetryOptions({ retryable: false }),
    }),
  )
export const createIdentityRuntime = () =>
  new RuntimeOptions({
    autoretry: false,
    maxAttempts: 1,
    connectTimeout: 3000,
    readTimeout: 10000,
    retryOptions: new RetryOptions({ retryable: false }),
  })
export const providerFailure = (errorCode: string): ProviderResult => ({
  status: "error",
  errorCode,
  code: null,
  bizCode: null,
  requestId: null,
})
export const createAliyunIdentityProvider = (config: IdentityConfig): IdentityProvider => {
  const client = identityProviderAvailable(config) ? createAliyunIdentityClient(config) : null
  return {
    verify: async (image) => {
      if (client === null) return providerFailure("identity_provider_unavailable")
      const stream = Readable.from(image)
      try {
        const response = await client.id2MetaVerifyWithOCRAdvance(
          new Id2MetaVerifyWithOCRAdvanceRequest({ certFileObject: stream }),
          createIdentityRuntime(),
        )
        return parseProviderResponse(response.body)
      } catch (error) {
        // The SDK can include raw response data in errors; only stable local codes leave this boundary.
        if (error instanceof Error) return providerFailure("identity_provider_unavailable")
        throw error
      } finally {
        stream.destroy()
      }
    },
  }
}

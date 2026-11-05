import { z } from "zod"

const schema = z.object({
  ADMIN_IDENTITY_MODE: z.enum(["off", "optional", "enforced"]).default("off"),
  ALIYUN_IDENTITY_REGION: z.enum(["cn-beijing", "cn-shanghai"]).default("cn-beijing"),
  ALIBABA_CLOUD_ACCESS_KEY_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: z.string().min(1).optional(),
  ALIBABA_CLOUD_SECURITY_TOKEN: z.string().min(1).optional(),
  IDENTITY_HMAC_KEY: z
    .string()
    .refine((value) => Buffer.byteLength(value, "utf8") === 32)
    .optional(),
  IDENTITY_HMAC_KEY_VERSION: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default("v1"),
  IDENTITY_DAILY_LIMIT: z.coerce.number().int().positive().max(1000000).default(1000),
  IDENTITY_USER_DAILY_LIMIT: z.coerce.number().int().positive().max(1000).default(5),
})
export const parseIdentityConfig = (environment: Readonly<Record<string, string | undefined>>) => {
  const result = schema.safeParse(
    Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [key, value === "" ? undefined : value]),
    ),
  )
  if (!result.success)
    throw new IdentityConfigurationError(
      `Invalid identity configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    )
  const parsed = result.data
  if (parsed.ADMIN_IDENTITY_MODE !== "off" && !parsed.IDENTITY_HMAC_KEY)
    throw new IdentityConfigurationError(
      "IDENTITY_HMAC_KEY is required when identity verification is enabled",
    )
  if (
    parsed.ADMIN_IDENTITY_MODE !== "off" &&
    (!parsed.ALIBABA_CLOUD_ACCESS_KEY_ID || !parsed.ALIBABA_CLOUD_ACCESS_KEY_SECRET)
  )
    throw new IdentityConfigurationError(
      "ALIBABA_CLOUD_ACCESS_KEY_ID and ALIBABA_CLOUD_ACCESS_KEY_SECRET are required when identity verification is enabled",
    )
  return {
    mode: parsed.ADMIN_IDENTITY_MODE,
    region: parsed.ALIYUN_IDENTITY_REGION,
    accessKeyId: parsed.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: parsed.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    securityToken: parsed.ALIBABA_CLOUD_SECURITY_TOKEN,
    hmacKey: parsed.IDENTITY_HMAC_KEY,
    hmacKeyVersion: parsed.IDENTITY_HMAC_KEY_VERSION,
    dailyLimit: parsed.IDENTITY_DAILY_LIMIT,
    userDailyLimit: parsed.IDENTITY_USER_DAILY_LIMIT,
  }
}
export type IdentityConfig = ReturnType<typeof parseIdentityConfig>
export class IdentityConfigurationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "IdentityConfigurationError"
  }
}
export const identityProviderAvailable = (config: IdentityConfig): boolean =>
  config.mode !== "off" && Boolean(config.accessKeyId && config.accessKeySecret && config.hmacKey)

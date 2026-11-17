import ky, { HTTPError } from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

export const CustomerSchema = z.object({
  boxAdminCount: z.number().int(),
  boxCount: z.number().int(),
  createdAt: z.coerce.date(),
  displayName: z.string(),
  email: z.string(),
  enabled: z.boolean(),
  groupId: z.string().uuid().nullable(),
  id: z.string().uuid(),
})
export type Customer = z.infer<typeof CustomerSchema>

export type CustomerCreate = {
  readonly displayName: string
  readonly email: string
  readonly password: string
}

export type CustomerUpdate = {
  readonly enabled?: boolean
  readonly password?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  email_taken: "这个邮箱已经有账号了",
  invalid_customer_request: "请检查名称、邮箱和密码（密码至少 8 位）",
  name_taken: "这个名称已被其他客户或分组使用",
  not_found: "客户不存在",
}

const describeError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = z
      .object({ error: z.string() })
      .safeParse(await error.response.json().catch(() => null))
    if (body.success) return ERROR_MESSAGES[body.data.error] ?? "客户操作失败"
  }
  return "客户操作失败"
}

const parseOrThrow = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    throw new Error(await describeError(error))
  }
}

export interface CustomersApi {
  create(input: CustomerCreate): Promise<Customer>
  list(): Promise<readonly Customer[]>
  update(customerId: string, input: CustomerUpdate): Promise<Customer>
}

export const createCustomersApi = (apiBaseUrl = "/api"): CustomersApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    create: async (input) =>
      parseOrThrow(async () =>
        CustomerSchema.parse(await client.post("customers", { json: input }).json()),
      ),
    list: async () =>
      parseOrThrow(
        async () =>
          z.object({ items: z.array(CustomerSchema) }).parse(await client.get("customers").json())
            .items,
      ),
    update: async (customerId, input) =>
      parseOrThrow(async () =>
        CustomerSchema.parse(
          await client.patch(`customers/${encodeURIComponent(customerId)}`, { json: input }).json(),
        ),
      ),
  }
}

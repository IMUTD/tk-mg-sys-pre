import { z } from "zod"

import { createProductionApp } from "./composition"
import { retentionMs } from "./db/retention"

const ApiRuntimeConfigurationSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  REDIS_URL: z.string().url(),
  SECRET_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, "utf8") === 32,
      "SECRET_ENCRYPTION_KEY must be exactly 32 UTF-8 bytes",
    ),
  TK_MG_SYSTEM_ACTOR_ID: z.string().uuid(),
})

export type ApiRuntimeConfig = {
  readonly databaseUrl: string
  readonly port: number
  readonly redisUrl: string
  readonly secretEncryptionKey: string
  readonly systemActorId: string
}

type ApiRequestHandlerOptions = {
  readonly appFetch: (request: Request) => Response | Promise<Response>
  readonly checkReadiness: () => Promise<void>
}

export const createApiRequestHandler =
  ({
    appFetch,
    checkReadiness,
  }: ApiRequestHandlerOptions): ((request: Request) => Promise<Response>) =>
  async (request) => {
    if (new URL(request.url).pathname !== "/ready") return await appFetch(request)
    return checkReadiness().then(
      () => Response.json({ status: "ok" }),
      () => Response.json({ status: "unavailable" }, { status: 503 }),
    )
  }

export const parseApiRuntimeConfig = (
  environment: Record<string, string | undefined>,
): ApiRuntimeConfig => {
  const config = ApiRuntimeConfigurationSchema.parse(environment)
  return {
    databaseUrl: config.DATABASE_URL,
    port: config.PORT,
    redisUrl: config.REDIS_URL,
    secretEncryptionKey: config.SECRET_ENCRYPTION_KEY,
    systemActorId: config.TK_MG_SYSTEM_ACTOR_ID,
  }
}

export const startApiServer = (environment: Record<string, string | undefined>) => {
  const config = parseApiRuntimeConfig(environment)
  const productionApp = createProductionApp(config)
  const purge = () => {
    void productionApp.purgeExpiredRows().catch((error: unknown) => {
      console.error("retention purge failed", error)
    })
  }
  purge()
  const retentionTimer = setInterval(purge, retentionMs)
  const server = Bun.serve({
    fetch: createApiRequestHandler({
      appFetch: productionApp.app.fetch,
      checkReadiness: productionApp.checkReadiness,
    }),
    // Claim holds the response for up to 25s. Bun's default idle timeout is 10s.
    idleTimeout: 60,
    port: config.port,
  })
  let stopped = false

  return {
    close: async (): Promise<void> => {
      if (stopped) return
      stopped = true
      clearInterval(retentionTimer)
      server.stop(true)
      await productionApp.close()
    },
  }
}

export const createShutdownHandler = (
  close: () => Promise<void>,
  onError: (error: unknown) => void,
): (() => void) => {
  let isClosing = false
  return () => {
    if (isClosing) return
    isClosing = true
    void close().catch(onError)
  }
}

if (import.meta.main) {
  const runtime = startApiServer(Bun.env)
  const shutdown = createShutdownHandler(runtime.close, (error: unknown) => {
    console.error("API shutdown failed", error)
    process.exitCode = 1
  })
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}
